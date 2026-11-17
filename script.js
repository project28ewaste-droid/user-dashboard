// EcoVault — Firebase Authentication (Email + Google) and Cloud Firestore user data.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, orderBy, where,
  onSnapshot, runTransaction, writeBatch, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAYuNheKRtMkK09R4nsm6JN69ISKFeserg",
  authDomain: "ewaste-6006f.firebaseapp.com",
  projectId: "ewaste-6006f",
  storageBucket: "ewaste-6006f.firebasestorage.app",
  messagingSenderId: "333334179587",
  appId: "1:333334179587:web:12d87a28b87c251ecc8336",
  measurementId: "G-DLXS1ZSMVY"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
isSupported().then(ok => { if (ok) getAnalytics(app); }).catch(() => {});

const $ = (id) => document.getElementById(id);

let mode = "login";
let currentUid = null;
let currentData = null;
let currentHistory = [];
let currentClaims = [];
let unsubscribers = [];
let liveMode = false; // Enable only after your backend and ESP32 endpoints are ready.
const binId = new URLSearchParams(location.search).get("bin");

// Firestore layout: users/{uid} (profile + totals), users/{uid}/history/{entryId} (waste deposits only)
const userRef = (uid = currentUid) => doc(db, "users", uid);
const historyCol = (uid = currentUid) => collection(db, "users", uid, "history");
// Reward claims live in their own top-level collection: rewards/{claimId} (with uid).
const rewardsCol = collection(db, "rewards");
const stopListeners = () => { unsubscribers.forEach(fn => fn()); unsubscribers = []; };

const friendlyError = (error) => ({
  "auth/email-already-in-use": "An account with this email already exists. Please log in.",
  "auth/invalid-credential": "Incorrect email or password. Create an account if this is your first visit.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "No account found for this email. Please create one.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/popup-closed-by-user": "Google sign-in was cancelled.",
  "auth/unauthorized-domain": "This domain is not authorized in Firebase Authentication settings.",
  "auth/operation-not-allowed": "This sign-in method is not enabled in the Firebase console.",
  "permission-denied": "Permission denied. Check your Firestore security rules."
})[error?.code] || error?.message || "Something went wrong. Please try again.";

function switchMode(nextMode) {
  mode = nextMode;
  const signup = mode === "signup";
  $("nameLabel").hidden = !signup;
  $("name").required = signup;
  $("name").autocomplete = signup ? "name" : "off";
  $("pass").autocomplete = signup ? "new-password" : "current-password";
  $("submit").innerHTML = signup ? 'Create account <span>→</span>' : 'Login to dashboard <span>→</span>';
  $("authTitle").textContent = signup ? "Create your account" : "Welcome back";
  $("authSubtitle").textContent = signup
    ? "Join EcoVault and get rewarded for recycling."
    : "Sign in to continue to your recycling dashboard.";
  $("google").innerHTML = `<span class="google-mark">G</span> ${signup ? "Sign up with Google" : "Sign in with Google"}`;
  $("tabLogin").classList.toggle("active", !signup);
  $("tabSignup").classList.toggle("active", signup);
  $("err").textContent = "";
}

function setBusy(busy) {
  $("submit").disabled = busy;
  $("google").disabled = busy;
}

// Create the user's profile node on first sign-in.
async function ensureProfile(user, name) {
  const snap = await getDoc(userRef(user.uid));
  if (!snap.exists()) {
    await setDoc(userRef(user.uid), {
      name: name || user.displayName || "User",
      email: (user.email || "").toLowerCase(),
      points: 0,
      kg: 0,
      deposits: 0,
      createdAt: serverTimestamp()
    });
  }
}

function showLogin() {
  $("app").hidden = true;
  $("login").hidden = false;
  $("form").reset();
  $("reading").hidden = true;
  $("voucher").textContent = "";
  switchMode("login");
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function enterDashboard(user) {
  // The [hidden] CSS rule in style.css is essential: it allows this navigation to work.
  $("login").hidden = true;
  $("app").hidden = false;
  $("bin").textContent = binId ? `Collection bin: ${binId}` : "Demo collection bin";
  $("who").textContent = firstName(user.displayName);
  showPage();

  stopListeners();
  const onError = (error) => {
    console.error("Firestore read failed:", error);
    $("rows").innerHTML = `<tr><td colspan="4">${escapeHTML(friendlyError(error))}</td></tr>`;
  };
  unsubscribers.push(onSnapshot(userRef(user.uid), (snap) => {
    currentData = snap.data() || null;
    renderDashboard();
  }, onError));
  unsubscribers.push(onSnapshot(query(historyCol(user.uid), orderBy("date", "desc")), (snap) => {
    currentHistory = snap.docs.map(d => d.data());
    renderDashboard();
  }, onError));
  unsubscribers.push(onSnapshot(query(rewardsCol, where("uid", "==", user.uid)), (snap) => {
    currentClaims = snap.docs.map(d => d.data()).sort((a, b) => b.date - a.date);
    renderDashboard();
  }, onError));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Reward points per kg for each waste type. Change these numbers to adjust rewards.
// Keep the dropdown labels in index.html in sync.
const POINTS_PER_KG = {
  "Battery": 150,
  "Board": 200,
  "Wires & other": 80
};
const pointsFor = (type, weight) => Math.round(weight * (POINTS_PER_KG[type] || 0));

function updatePointsPreview() {
  const type = $("type").value;
  const weight = Number($("weight").value);
  $("pointsPreview").textContent = Number.isFinite(weight) && weight > 0
    ? `${type}: ${weight.toFixed(2)} kg × ${POINTS_PER_KG[type]} pts = ${pointsFor(type, weight)} points`
    : `${type} earns ${POINTS_PER_KG[type]} points per kg. Enter weight to see your points.`;
}
$("type").addEventListener("change", updatePointsPreview);
$("weight").addEventListener("input", updatePointsPreview);

// Simple hash router: #overview, #deposit, #history
const PAGES = ["overview", "deposit", "rewards", "history", "claims"];
function showPage() {
  const page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  document.querySelectorAll("[data-page]").forEach(el => { el.hidden = el.dataset.page !== page; });
  document.querySelectorAll("[data-nav]").forEach(el => el.classList.toggle("active", el.dataset.nav === page));
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", showPage);

const firstName = (name) => (name || "User").trim().split(/\s+/)[0] || "User";

function renderDashboard() {
  const user = currentData;
  if (!user) return;
  const history = currentHistory;
  $("who").textContent = firstName(user.name);
  $("pts").textContent = user.points || 0;
  $("kg").textContent = `${Number(user.kg || 0).toFixed(2)} kg`;
  $("num").textContent = user.deposits || 0;
  $("cash").textContent = `₹${Math.floor((user.points || 0) / 50) * 5}`;
  const pts = Number(user.points || 0);
  const vouchers = Math.floor(pts / 50);
  $("rwPts").textContent = pts;
  $("rwCash").textContent = `₹${vouchers * 5}`;
  $("rwCount").textContent = vouchers;
  $("rwNext").textContent = 50 - (pts % 50);
  $("redeem").disabled = pts < 50;

  $("rows").innerHTML = history.length
    ? history.map(item => `<tr>
        <td>${escapeHTML(new Date(item.date).toLocaleString())}</td>
        <td>${escapeHTML(item.type)}</td>
        <td>${escapeHTML(String(item.weight))} kg</td>
        <td>+${Number(item.points)}</td>
      </tr>`).join("")
    : '<tr><td colspan="4">No deposits yet. Your recycling activity will appear here.</td></tr>';

  $("clCount").textContent = currentClaims.length;
  $("clValue").textContent = `₹${currentClaims.reduce((sum, c) => sum + Number(c.amount || 0), 0)}`;
  $("clPoints").textContent = currentClaims.reduce((sum, c) => sum + Number(c.points || 0), 0);

  $("claimRows").innerHTML = currentClaims.length
    ? currentClaims.map(c => `<tr>
        <td>${escapeHTML(new Date(c.date).toLocaleString())}</td>
        <td>${escapeHTML(c.code)}</td>
        <td>₹${Number(c.amount)}</td>
        <td>-${Number(c.points)}</td>
        <td>${escapeHTML(c.status || "pending")}</td>
      </tr>`).join("")
    : '<tr><td colspan="5">No rewards claimed yet.</td></tr>';
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

$("tabLogin").addEventListener("click", () => switchMode("login"));
$("tabSignup").addEventListener("click", () => switchMode("signup"));

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("err").textContent = "";
  const email = $("email").value.trim().toLowerCase();
  const password = $("pass").value;
  setBusy(true);
  try {
    if (mode === "signup") {
      const name = $("name").value.trim();
      if (!name) { $("err").textContent = "Please enter your name."; return; }
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(user, { displayName: name });
      await ensureProfile(user, name);
      // onAuthStateChanged may have created the profile first with a default name.
      await updateDoc(userRef(user.uid), { name });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    // onAuthStateChanged opens the dashboard.
  } catch (error) {
    $("err").textContent = friendlyError(error);
  } finally {
    setBusy(false);
  }
});

$("google").addEventListener("click", async () => {
  $("err").textContent = "";
  setBusy(true);
  try {
    const { user } = await signInWithPopup(auth, provider);
    await ensureProfile(user);
  } catch (error) {
    $("err").textContent = friendlyError(error);
  } finally {
    setBusy(false);
  }
});

$("open").addEventListener("click", async () => {
  $("open").disabled = true;
  $("lidStatus").textContent = "Requesting bin lid...";
  if (liveMode) {
    try {
      const response = await fetch("/api/bin/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ binId })
      });
      const data = await response.json();
      if (!response.ok || !data.opened) throw new Error("The bin did not confirm that the lid opened.");
    } catch (error) {
      $("lidStatus").textContent = error.message;
      $("open").disabled = false;
      return;
    }
  } else {
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  $("lidStatus").textContent = "✓ Lid-open request confirmed (demo). Deposit your item below.";
  $("reading").hidden = false;
  $("open").disabled = false;
});

$("finish").addEventListener("click", async () => {
  let type = $("type").value;
  let weight = Number($("weight").value);

  if (liveMode) {
    try {
      const response = await fetch(`/api/bin/reading?binId=${encodeURIComponent(binId || "")}`);
      const data = await response.json();
      if (!response.ok) throw new Error("Sensor reading unavailable.");
      type = data.wasteType;
      weight = Number(data.weightKg);
    } catch (error) {
      alert(error.message || "Sensor reading unavailable.");
      return;
    }
  }
  if (!Number.isFinite(weight) || weight <= 0 || weight > 20) {
    alert("Enter a valid weight between 0.01 and 20 kg.");
    return;
  }
  if (!currentUid) { alert("Please log in again."); return; }

  if (!POINTS_PER_KG[type]) { alert("Unknown waste type. Choose Battery, Board or Wires & other."); return; }
  const points = pointsFor(type, weight);
  $("finish").disabled = true;
  try {
    // Totals and the history entry are written together (all or nothing).
    const batch = writeBatch(db);
    batch.update(userRef(), { kg: increment(weight), points: increment(points), deposits: increment(1) });
    batch.set(doc(historyCol()), {
      date: Date.now(), type, weight: weight.toFixed(2), points, binId: binId || "demo"
    });
    await batch.commit();
    $("lidStatus").textContent = `✓ Deposit saved: ${type}, ${weight.toFixed(2)} kg. You earned ${points} points.`;
    $("reading").hidden = true;
    $("weight").value = "";
    updatePointsPreview();
  } catch (error) {
    alert(friendlyError(error));
  } finally {
    $("finish").disabled = false;
  }
});

$("redeem").addEventListener("click", async () => {
  if (!currentUid) return;
  const code = `ECO-${Math.random().toString(36).slice(2, 7).toUpperCase()}-DEMO`;
  try {
    const redeemed = await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef());
      if (!snap.exists() || (snap.data().points || 0) < 50) return false;
      tx.update(userRef(), { points: increment(-50) });
      const u = snap.data();
      tx.set(doc(rewardsCol), {
        uid: currentUid, name: u.name || "", email: u.email || "",
        code, points: 50, amount: 5, status: "pending",
        date: Date.now(), claimedAt: serverTimestamp()
      });
      return true;
    });
    if (!redeemed) {
      alert("You need at least 50 points to redeem a voucher.");
      return;
    }
    $("voucher").textContent = `Sample voucher code: ${code} (not a live gift card).`;
  } catch (error) {
    alert(friendlyError(error));
  }
});

$("logout").addEventListener("click", async () => {
  try { await signOut(auth); }
  catch (error) { console.warn("Firebase sign-out:", error); }
});

// Keeps users logged in across page reloads.
onAuthStateChanged(auth, async (user) => {
  stopListeners();
  currentData = null;
  currentHistory = [];
  currentClaims = [];
  if (user) {
    currentUid = user.uid;
    try { await ensureProfile(user); } catch (error) { console.error(error); }
    enterDashboard(user);
  } else {
    currentUid = null;
    showLogin();
  }
});

switchMode("login");
updatePointsPreview();
