const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.syncUserRoleClaims = functions.firestore
  .document("users/{uid}")
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const afterData = change.after.exists ? change.after.data() : null;

    if (!afterData) {
      // User doc deleted — optionally clear claims
      await admin.auth().setCustomUserClaims(uid, {});
      console.log(`Cleared claims for deleted user ${uid}`);
      return;
    }

    const roleId = afterData.roleId;
    if (!roleId) {
      console.log(`No roleId for user ${uid}, skipping claim update`);
      return;
    }

    // Load role document
    const roleSnap = await admin.firestore().doc(`roles/${roleId}`).get();
    if (!roleSnap.exists) {
      console.warn(`Role ${roleId} not found for user ${uid}`);
      return;
    }

    const roleData = roleSnap.data();
    let permissions = roleData.permissions || [];

    // Ensure permissions is an array
    if (!Array.isArray(permissions)) {
      permissions = [permissions];
    }

    // Update custom claims
    await admin.auth().setCustomUserClaims(uid, { permissions });
    console.log(`Updated claims for user ${uid} with permissions:`, permissions);
  });