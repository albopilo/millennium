import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useNavigate } from "react-router-dom";

export default function LogoutButton() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth); // Firebase Auth sign-out
      navigate("/login");  // Redirect to login page
    } catch (err) {
      console.error("Logout failed:", err);
      alert("Error logging out. Please try again.");
    }
  };

  return (
    <button onClick={handleLogout} style={{ cursor: "pointer" }}>
      Logout
    </button>
  );
}