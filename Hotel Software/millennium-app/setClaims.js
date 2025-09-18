require("dotenv").config();
const admin = require("firebase-admin");

const serviceAccount = {
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function setClaims(uid) {
  // 1. Get the user's roleId from Firestore
  const userSnap = await admin.firestore().doc(`users/${uid}`).get();
  const roleId = userSnap.data()?.roleId;
  if (!roleId) {
    console.error(`No roleId for user ${uid}`);
    return;
  }

  // 2. Get the permissions from the role doc
  const roleSnap = await admin.firestore().doc(`roles/${roleId}`).get();
  const permissions = roleSnap.data()?.permissions || [];

  // 3. Set custom claims
  await admin.auth().setCustomUserClaims(uid, { permissions });
  console.log(`Updated ${uid} with permissions:`, permissions);
}

// Example run: replace UID with a real one
setClaims("YD0Trsxo2SSbu3vOkDEdXDT3IsZ2").then(() => process.exit());
