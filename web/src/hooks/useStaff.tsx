import { createContext, useContext, useState, type ReactNode } from "react";

export type StaffSession = {
  id: number;
  name: string;
  role: "admin" | "manager" | "cashier";
  username: string;
};

const KEY = "pumppos_staff";

const StaffContext = createContext<{
  staff: StaffSession | null;
  login: (s: StaffSession) => void;
  logout: () => void;
}>({ staff: null, login: () => {}, logout: () => {} });

export function StaffProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffSession | null>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as StaffSession) : null;
    } catch {
      return null;
    }
  });

  const login = (s: StaffSession) => {
    localStorage.setItem(KEY, JSON.stringify(s));
    setStaff(s);
  };
  const logout = () => {
    localStorage.removeItem(KEY);
    setStaff(null);
  };

  return <StaffContext.Provider value={{ staff, login, logout }}>{children}</StaffContext.Provider>;
}

export const useStaff = () => useContext(StaffContext);
