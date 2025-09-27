// scripts/setUserRole.js
import admin from "firebase-admin";

// Initialize once
admin.initializeApp({
  credential: admin.credential.cert("./serviceAccountKey.json"),
});


const db = admin.firestore();

/**
 * Assign roleId to a user, and sync that role's permissions
 */
async function setUserRole(uid, roleId) {
  // 1. Load role doc
  const roleSnap = await db.collection("roles").doc(roleId).get();
  if (!roleSnap.exists) {
    throw new Error(`Role ${roleId} does not exist`);
  }
  const roleData = roleSnap.data();
  const perms = roleData.permissions || [];

  // 2. Save roleId in users/{uid} doc
  await db.collection("users").doc(uid).set(
    { roleId },
    { merge: true }
  );

  // 3. Push permissions into Auth custom claims
  await admin.auth().setCustomUserClaims(uid, {
    roleId,
    permissions: perms,
  });

  console.log(
    `✅ User ${uid} assigned role "${roleId}" with permissions:`,
    perms
  );
}

// Run as CLI: node setUserRole.js <uid> <roleId>
const [,, uid, roleId] = process.argv;
if (!uid || !roleId) {
  console.error("Usage: node setUserRole.js <uid> <roleId>");
  process.exit(1);
}
setUserRole(uid, roleId).catch((err) => {
  console.error("Error setting role:", err);
  process.exit(1);
});
