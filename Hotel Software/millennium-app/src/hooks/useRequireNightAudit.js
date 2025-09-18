// src/hooks/useRequireNightAudit.js
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * returns { ready: boolean, lastRun: string|null }
 * ready=true means an audit exists for today's business day.
 */
export default function useRequireNightAudit(tzOffset = 7) {
  const [ready, setReady] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // Determine business day string same as nightAudit util (copy-of)
        const now = new Date();
        const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
        const tzMs = utcMs + tzOffset * 3600 * 1000;
        const nowTz = new Date(tzMs);
        const hours = nowTz.getHours();
        let businessDay = new Date(nowTz);
        if (hours < 4) businessDay.setDate(businessDay.getDate() - 1);
        businessDay.setHours(0,0,0,0);
        const businessDayStr = businessDay.toISOString().slice(0,10);

        const logRef = doc(db, "nightAuditLogs", businessDayStr);
        const snap = await getDoc(logRef);
        if (snap.exists()) {
          setReady(true);
          setLastRun(snap.data()?.runAt || snap.data()?.createdAt || new Date().toISOString());
        } else {
          setReady(false);
          setLastRun(null);
        }
      } catch (err) {
        console.error("useRequireNightAudit:", err);
        setReady(false);
      }
    })();
  }, [tzOffset]);

  return { ready, lastRun };
}
