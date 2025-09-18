const admin = require("firebase-admin");
const fs = require("fs");

// Load service account key
const serviceAccount = require("./serviceAccountKey.json");

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Helper to import a collection from JSON
async function importCollection(collectionName, data) {
  const colRef = db.collection(collectionName);
  for (const [docId, docData] of Object.entries(data)) {
    await colRef.doc(docId).set(docData);
    console.log(`Imported ${collectionName}/${docId}`);
  }
}

async function runImport() {
  try {
    // Import roles
    const rolesData = JSON.parse(fs.readFileSync("roles.json", "utf8")).roles;
    await importCollection("roles", rolesData);

    // Import users
    const usersData = JSON.parse(fs.readFileSync("users.json", "utf8")).users;
    await importCollection("users", usersData);

    console.log("✅ Import complete!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Import failed:", err);
    process.exit(1);
  }
}

runImport();