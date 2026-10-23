// Gemeinsamer Firebase-Zugang für alle Ansichten.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js?v=202610232236";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const HOST_UID = "JIXlQDiywfTPFhtg6I2Ki2uAc7D2";
export const APP_URL = "https://squizzzzz-live.github.io/";
