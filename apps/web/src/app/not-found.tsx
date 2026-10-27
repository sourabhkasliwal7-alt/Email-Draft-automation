import { Compass, Home } from "lucide-react";
import { StatusPage } from "@/components/status-page";
import { LinkButton } from "@/components/link-button";

export default function NotFound() {
  return (
    <StatusPage icon={<Compass />} title="That page does not exist" actions={<LinkButton href="/" icon={<Home aria-hidden />}>Go to Home</LinkButton>}>
      <p>The address may be old or mistyped. Home has everything you need: leads, drafts and setup are one click away.</p>
    </StatusPage>
  );
}
