// loyaltyFirebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const loyaltyConfig = {
  apiKey: "AIzaSyDNvgS_PqEHU3llqHt0XHN30jJgiQWLkdc",
  authDomain: "e-loyalty-12563.firebaseapp.com",
  projectId: "e-loyalty-12563",
  storageBucket: "e-loyalty-12563.appspot.com",
  messagingSenderId: "3887061029",
  appId: "1:3887061029:web:f9c238731d7e6dd5fb47cc",
  measurementId: "G-966P8W06W2"
};

// Initialise as a named secondary app
const loyaltyApp = initializeApp(loyaltyConfig, "loyaltyApp");
export const loyaltyDb = getFirestore(loyaltyApp);