import { BrowserRouter } from "react-router";
import App from "@/App";
import "@/index.css";
import "@/lib/enableTailwindMerge";

export default function AuthenticatedApp() {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
