 // src/hooks/useMountLogger.js
 import { useEffect } from "react";

 export default function useMountLogger(label, extra = {}) {
   useEffect(() => {
     console.log(`[MOUNT] ${label}`, extra);
     return () => console.log(`[UNMOUNT] ${label}`, extra);
   }, [label]);
 }
