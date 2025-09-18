// src/lib/audit.js
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
export async function logAction({ userId, action, entity, entityId, before, after }) {
  try {
    await addDoc(collection(db, "auditLogs"), {
      ts: serverTimestamp(), userId, action, entity, entityId, before: before ?? null, after: after ?? null
    });
  } catch (e) { /* swallow to never block UX */ }
}