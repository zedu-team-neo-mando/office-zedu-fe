import type { Metadata } from "next";
import PersonalOfficePage from "../_components/my-office/personal-office-page";
import "~/app/office/office.css";

export const metadata: Metadata = {
  title: "My office · Zedu",
  description:
    "Your own 3D office: decorate it, style your avatar and visit your teammates' offices to talk.",
};

export default function MyOfficePage() {
  return <PersonalOfficePage />;
}
