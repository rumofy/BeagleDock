import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import type { UserProfile } from "../types";

import { t } from "../i18n";
export function useUserProfile() {
  const [userProfile, setUserProfile] = useState<UserProfile>({
    fullName: t("profile.user"),
    firstName: t("profile.you"),
    email: "",
    initials: "U",
  });
  // Operating system profile
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
