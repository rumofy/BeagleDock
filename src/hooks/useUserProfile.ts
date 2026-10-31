import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import type { UserProfile } from "../types";

export function useUserProfile() {
  const [userProfile, setUserProfile] = useState<UserProfile>({
    fullName: "Usuário",
    firstName: "Você",
    email: "",
    initials: "U",
  });
  // Perfil do Sistema Operacional
  useEffect(() => {
    if (!backendAvailable()) return;
    beagleApi
      .getUserProfile()
      .then((profile) => {
        if (profile && profile.fullName) {
          setUserProfile(profile);
        }
      })
      .catch(() => {});
  }, []);
  return { userProfile };
}
