const admin = require("firebase-admin");

// Download your service account key from Firebase Console > Project Settings > Service Accounts
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
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

// Replace with the UID of the staff account you want to update
setClaims("YD0Trsxo2SSbu3vOkDEdXDT3IsZ2").then(() => process.exit());