import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children, permissions, required, loading }) {
  if (loading) return <p>Loading...</p>;
  const can = (perm) => permissions.includes(perm) || permissions.includes("*");
  if (!can(required)) return <Navigate to="/" replace />;
  return children;
}