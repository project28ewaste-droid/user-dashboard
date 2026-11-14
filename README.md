# EcoVault E-Waste Rewards Dashboard

## Files
- `index.html` — login, signup and dashboard structure
- `style.css` — responsive white and light-green e-waste / circuit-board theme
- `script.js` — demo authentication, navigation, deposits, points, vouchers and history

## Run
1. Extract the ZIP.
2. Open the folder in VS Code.
3. Run `index.html` using the Live Server extension.
4. Select **Create account**, enter a name, email and password (at least 6 characters).
5. After creating the account, the dashboard opens automatically. Log out and use the same email/password to test login.

Use Live Server rather than opening the HTML file directly.

## Why the login navigation was failing
The `.login-screen` element uses `display: grid`. Without an explicit `[hidden]` rule, that author CSS can override the browser's default hidden styling. `style.css` now includes:

```css
[hidden] { display: none !important; }
```

The JavaScript also explicitly switches the `hidden` state of the login and dashboard sections.

## Firebase Google sign-in
Email signup/login works in demo mode using browser localStorage. This is for demonstration only and is not secure for production.

To enable Google sign-in:
1. Create a Firebase project and add a Web App.
2. Enable **Authentication → Sign-in method → Google**.
3. Copy the Firebase web configuration into `firebaseConfig` at the top of `script.js`.
4. Add your deployed domain under Firebase Authentication authorized domains.
5. Serve the site over HTTPS or localhost.

## QR and hardware
A QR code can point to `https://YOUR-DOMAIN/?bin=BIN001`; the page displays the bin ID.

This is still a front-end demo. Real ESP32 lid control and sensor readings require secure backend endpoints. Keep `liveMode = false` until those endpoints are implemented and tested. Do not award production points from untrusted client-side values. Demo voucher codes are not real gift cards.


## Theme
The interface uses a clean white and light-green palette with green recycling accents, pale circuit-board details, and readable dark-green text.
