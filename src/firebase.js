import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ── Firebase config ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAQoW0SRvK8xfs_5jeruQUlfqERDvfxqdk",
  authDomain: "iot-energy-monitor-cb06d.firebaseapp.com",
  projectId: "iot-energy-monitor-cb06d",
  storageBucket: "iot-energy-monitor-cb06d.firebasestorage.app",
  messagingSenderId: "852273116904",
  appId: "1:852273116904:web:0755cde8e45ae8411cfb5d",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
