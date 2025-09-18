import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

export default function usePermissions(user) {
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPermissions = async () => {
      if (!user) {
        setPermissions([]);
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          console.warn("No user doc found for", user.uid);
          setPermissions([]);
          return;
        }
        const userData = userSnap.data();

        let rolePerms = [];
        if (userData.roleId) {
          const roleRef = doc(db, "roles", userData.roleId);
          const roleSnap = await getDoc(roleRef);
          if (roleSnap.exists()) {
            rolePerms = roleSnap.data().permissions || [];
          }
        }

        let effective = [...new Set([...rolePerms, ...(userData.grants || [])])];
        if (userData.denies?.length) {
          effective = effective.filter(p => !userData.denies.includes(p));
        }
        if (rolePerms.includes("*") || (userData.grants || []).includes("*")) {
          if (!effective.includes("*")) effective.push("*");
        }

        setPermissions(effective);
        console.log("Effective permissions:", effective);
      } catch (err) {
        console.error("Error loading permissions:", err);
        setPermissions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPermissions();
  }, [user]);

  return { permissions, loading };
}