// EcoVault front-end demo. Replace the Firebase placeholders to enable Google sign-in.
const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  appId: "PASTE_APP_ID"
};

const $ = (id) => document.getElementById(id);
const getAll = () => {
  try { return JSON.parse(localStorage.getItem("ecoUsers") || "{}"); }
  catch { return {}; }
};
const saveAll = (users) => localStorage.setItem("ecoUsers", JSON.stringify(users));

let auth = null;
let provider = null;
let currentEmail = "";
let mode = "login";
let liveMode = false; // Enable only after your backend and ESP32 endpoints are ready.
const binId = new URLSearchParams(location.search).get("bin");

async function setupFirebase() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE_")) return;
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const { getAuth, GoogleAuthProvider } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    auth = getAuth(initializeApp(firebaseConfig));
    provider = new GoogleAuthProvider();
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    $("err").textContent = "Firebase could not be initialized. Check your Firebase configuration.";
  }
}

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
  $("tabLogin").classList.toggle("active", !signup);
  $("tabSignup").classList.toggle("active", signup);
  $("err").textContent = "";
}

function getCurrentUser() {
  return getAll()[currentEmail];
}

function updateCurrentUser(user) {
  const users = getAll();
  users[currentEmail] = user;
  saveAll(users);
}

function enterDashboard(displayName) {
  // The [hidden] CSS rule in style.css is essential: it allows this navigation to work.
  $("login").hidden = true;
  $("app").hidden = false;
  $("who").textContent = (displayName || "User").trim().split(/\s+/)[0] || "User";
  $("bin").textContent = binId ? `Collection bin: ${binId}` : "Demo collection bin";
  renderDashboard();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderDashboard() {
  const user = getCurrentUser();
  if (!user) return;
  $("pts").textContent = user.points || 0;
  $("kg").textContent = `${Number(user.kg || 0).toFixed(2)} kg`;
  $("num").textContent = (user.history || []).filter(item => Number(item.points) >= 0).length;
  $("cash").textContent = `₹${Math.floor((user.points || 0) / 50) * 5}`;

  const history = [...(user.history || [])].reverse();
  $("rows").innerHTML = history.length
    ? history.map(item => `<tr>
        <td>${escapeHTML(new Date(item.date).toLocaleString())}</td>
        <td>${escapeHTML(item.type)}</td>
        <td>${escapeHTML(String(item.weight))}${item.weight === "—" ? "" : " kg"}</td>
        <td>${Number(item.points) > 0 ? "+" : ""}${Number(item.points)}</td>
      </tr>`).join("")
    : '<tr><td colspan="4">No deposits yet. Your recycling activity will appear here.</td></tr>';
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

$("tabLogin").addEventListener("click", () => switchMode("login"));
$("tabSignup").addEventListener("click", () => switchMode("signup"));

$("form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("err").textContent = "";
  const users = getAll();
  const email = $("email").value.trim().toLowerCase();
  const password = $("pass").value;

  if (mode === "signup") {
    const name = $("name").value.trim();
    if (!name) { $("err").textContent = "Please enter your name."; return; }
    if (users[email]) { $("err").textContent = "An account with this email already exists. Please log in."; return; }
    users[email] = { name, password, points: 0, kg: 0, history: [] };
    saveAll(users);
    currentEmail = email;
    enterDashboard(name);
    return;
  }

  const account = users[email];
  if (!account || account.password !== password) {
    $("err").textContent = "Incorrect email or password. Create an account if this is your first visit.";
    return;
  }
  currentEmail = email;
  enterDashboard(account.name);
});

$("google").addEventListener("click", async () => {
  $("err").textContent = "";
  if (!auth || !provider) {
    $("err").textContent = "Google sign-in is not configured. Use email login, or add your Firebase web config in script.js.";
    return;
  }
  try {
    const { signInWithPopup } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const result = await signInWithPopup(auth, provider);
    currentEmail = result.user.email.toLowerCase();
    const users = getAll();
    if (!users[currentEmail]) {
      users[currentEmail] = { name: result.user.displayName || "User", points: 0, kg: 0, history: [] };
      saveAll(users);
    }
    enterDashboard(users[currentEmail].name);
  } catch (error) {
    $("err").textContent = error.message || "Google sign-in failed.";
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

  const user = getCurrentUser();
  if (!user) { alert("Please log in again."); return; }
  const points = Math.round(weight * 100);
  user.kg = Number(user.kg || 0) + weight;
  user.points = Number(user.points || 0) + points;
  user.history = user.history || [];
  user.history.push({ date: Date.now(), type, weight: weight.toFixed(2), points });
  updateCurrentUser(user);
  renderDashboard();
  $("lidStatus").textContent = `✓ Deposit saved: ${type}, ${weight.toFixed(2)} kg. You earned ${points} points.`;
  $("reading").hidden = true;
  $("weight").value = "";
});

$("redeem").addEventListener("click", () => {
  const user = getCurrentUser();
  if (!user || user.points < 50) {
    alert("You need at least 50 points to redeem a voucher.");
    return;
  }
  user.points -= 50;
  const code = `ECO-${Math.random().toString(36).slice(2, 7).toUpperCase()}-DEMO`;
  user.history = user.history || [];
  user.history.push({ date: Date.now(), type: `Voucher: ${code}`, weight: "—", points: -50 });
  updateCurrentUser(user);
  renderDashboard();
  $("voucher").textContent = `Sample voucher code: ${code} (not a live gift card).`;
});

$("logout").addEventListener("click", async () => {
  if (auth) {
    try {
      const { signOut } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      await signOut(auth);
    } catch (error) { console.warn("Firebase sign-out:", error); }
  }
  currentEmail = "";
  $("app").hidden = true;
  $("login").hidden = false;
  $("form").reset();
  $("reading").hidden = true;
  $("voucher").textContent = "";
  switchMode("login");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

setupFirebase();
switchMode("login");
