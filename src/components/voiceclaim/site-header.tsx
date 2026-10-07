import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import { Wordmark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { to: "/", label: "Session" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
] as const;

export function SiteHeader() {
  return (
    <header className="app-header sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-7 px-5 sm:px-7">
        <Link to="/" className="shrink-0 text-white">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="rounded-md px-3 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/8 hover:text-white"
              activeProps={{ className: "bg-white/10 text-white" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto hidden text-[10px] tracking-[0.18em] text-white/45 uppercase lg:block">
          Evidence over opinion
        </span>
        <Link
          to="/history"
          className="header-icon-button mobile-history-link"
          aria-label="Session history"
        >
          <History className="size-4" />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
