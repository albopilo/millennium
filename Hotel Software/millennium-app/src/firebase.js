import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {

  apiKey: "AIzaSyAlZpcn0eTxfu1z0Ssn78Pm-UQWhjXF_ds",

  authDomain: "millennium-1de56.firebaseapp.com",

  projectId: "millennium-1de56",

  storageBucket: "millennium-1de56.firebasestorage.app",

  messagingSenderId: "263308664840",

  appId: "1:263308664840:web:e223d771e1eb69cc7bb1bd"

};


const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);