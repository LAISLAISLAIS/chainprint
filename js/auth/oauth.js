/**
 * Google + Apple sign-in.
 * Real SDKs when Client IDs are configured; localhost demo otherwise.
 */

import { authConfig } from "./config.js";
import { loginWithSocial } from "./session.js";

function isLocalHost() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export function socialStatus() {
  return {
    google: Boolean(authConfig.googleClientId),
    apple: Boolean(authConfig.appleClientId),
    demo: isLocalHost() && (!authConfig.googleClientId || !authConfig.appleClientId),
  };
}

function loadScript(src, id) {
  return new Promise((resolve, reject) => {
    if (id && document.getElementById(id)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    if (id) s.id = id;
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

function parseJwt(token) {
  const part = token.split(".")[1];
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function demoSocial(provider) {
  const profiles = {
    google: {
      provider: "google",
      email: "demo.google@chainprint.local",
      name: "Alex Morgan",
      providerUserId: "demo-google",
    },
    apple: {
      provider: "apple",
      email: "demo.apple@chainprint.local",
      name: "Sam Rivera",
      providerUserId: "demo-apple",
    },
  };
  return loginWithSocial(profiles[provider]);
}

/**
 * @param {'google' | 'apple'} provider
 */
export async function signInWithProvider(provider) {
  if (provider === "google") {
    if (authConfig.googleClientId) return signInWithGoogle();
    if (isLocalHost()) return demoSocial("google");
    throw Object.assign(
      new Error("Google sign-in isn’t configured yet. Add googleClientId in js/auth/config.js."),
      { code: "not_configured" }
    );
  }

  if (provider === "apple") {
    if (authConfig.appleClientId) return signInWithApple();
    if (isLocalHost()) return demoSocial("apple");
    throw Object.assign(
      new Error("Apple sign-in isn’t configured yet. Add appleClientId in js/auth/config.js."),
      { code: "not_configured" }
    );
  }

  throw new Error("Unknown provider");
}

async function signInWithGoogle() {
  await loadScript("https://accounts.google.com/gsi/client", "google-gsi");

  const google = window.google;
  if (!google?.accounts?.id) {
    throw new Error("Google Sign-In failed to load.");
  }

  return new Promise((resolve, reject) => {
    google.accounts.id.initialize({
      client_id: authConfig.googleClientId,
      callback: async (response) => {
        try {
          if (!response.credential) {
            reject(Object.assign(new Error("Google sign-in was cancelled."), { code: "cancelled" }));
            return;
          }
          const payload = parseJwt(response.credential);
          const account = await loginWithSocial({
            provider: "google",
            email: payload.email,
            name: payload.name || payload.given_name || "",
            providerUserId: payload.sub,
          });
          resolve(account);
        } catch (err) {
          reject(err);
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    // Prompt One Tap / account chooser; fallback to renderButton click path
    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // Popup OAuth token client as fallback
        const client = google.accounts.oauth2.initTokenClient({
          client_id: authConfig.googleClientId,
          scope: "email profile openid",
          callback: async (tokenResponse) => {
            try {
              if (tokenResponse.error) {
                reject(Object.assign(new Error(tokenResponse.error_description || "Google sign-in failed."), { code: "oauth" }));
                return;
              }
              const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
              });
              if (!res.ok) throw new Error("Could not fetch Google profile.");
              const profile = await res.json();
              const account = await loginWithSocial({
                provider: "google",
                email: profile.email,
                name: profile.name || "",
                providerUserId: profile.sub,
              });
              resolve(account);
            } catch (err) {
              reject(err);
            }
          },
          error_callback: () => {
            reject(Object.assign(new Error("Google sign-in was cancelled."), { code: "cancelled" }));
          },
        });
        client.requestAccessToken({ prompt: "consent" });
      }
    });
  });
}

async function signInWithApple() {
  await loadScript(
    "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js",
    "apple-auth"
  );

  const AppleID = window.AppleID;
  if (!AppleID?.auth) {
    throw new Error("Apple Sign-In failed to load.");
  }

  AppleID.auth.init({
    clientId: authConfig.appleClientId,
    scope: "name email",
    redirectURI: authConfig.appleRedirectURI,
    usePopup: true,
  });

  try {
    const data = await AppleID.auth.signIn();
    const idToken = data?.authorization?.id_token;
    if (!idToken) {
      throw Object.assign(new Error("Apple sign-in was cancelled."), { code: "cancelled" });
    }
    const payload = parseJwt(idToken);
    const nameFromApple = data?.user?.name
      ? [data.user.name.firstName, data.user.name.lastName].filter(Boolean).join(" ")
      : "";
    return loginWithSocial({
      provider: "apple",
      email: payload.email || `${payload.sub}@privaterelay.appleid.com`,
      name: nameFromApple || "",
      providerUserId: payload.sub,
    });
  } catch (err) {
    if (err?.code === "cancelled") throw err;
    if (err?.error === "popup_closed_by_user") {
      throw Object.assign(new Error("Apple sign-in was cancelled."), { code: "cancelled" });
    }
    throw err;
  }
}
