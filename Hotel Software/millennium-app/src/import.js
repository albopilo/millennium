const admin = require("firebase-admin");
const fs = require("fs");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function importCollection(collectionName, data) {
  for (const [docId, docData] of Object.entries(data)) {
    await db.collection(collectionName).doc(docId).set(docData);
    console.log(`Imported ${collectionName}/${docId}`);
  }
}

(async () => {
  try {
    const roomsData = JSON.parse(fs.readFileSync("rooms.json", "utf8")).rooms;
    await importCollection("rooms", roomsData);

    const channelsData = JSON.parse(fs.readFileSync("channels.json", "utf8")).channels;
    await importCollection("channels", channelsData);

    console.log("✅ Import complete!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Import failed:", err);
    process.exit(1);
  }
})();