import { Link } from "react-router";
import { Compass, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound({ forbidden = false }: { forbidden?: boolean }) {
  const Icon = forbidden ? ShieldAlert : Compass;
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
      <Icon className="h-8 w-8 text-[#98a2b3]" />
      <h1 className="mt-4 font-condensed text-3xl font-semibold text-[#101828]">{forbidden ? "Access restricted" : "Page not found"}</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[#667085]">
        {forbidden ? "Your role does not include this area. Ask an administrator if you need access." : "The page you are looking for does not exist."}
      </p>
      <Button asChild className="mt-6"><Link to="/">Back to overview</Link></Button>
    </div>
  );
}
