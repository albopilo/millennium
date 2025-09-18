import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const loyaltyConfig = {
  apiKey: process.env.REACT_APP_LOYALTY_API_KEY,
  authDomain: process.env.REACT_APP_LOYALTY_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_LOYALTY_PROJECT_ID,
  storageBucket: process.env.REACT_APP_LOYALTY_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_LOYALTY_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_LOYALTY_APP_ID,
  measurementId: process.env.REACT_APP_LOYALTY_MEASUREMENT_ID,
};

const loyaltyApp = initializeApp(loyaltyConfig, "loyaltyApp");
export const loyaltyDb = getFirestore(loyaltyApp);
