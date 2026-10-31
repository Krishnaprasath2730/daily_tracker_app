import { lazy, Suspense, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileText,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Play,
  Router,
  ScrollText,
  ShieldCheck,
  UserCog,
  UsersRound,
} from "lucide-react";
import { Toaster } from "sonner";
import type { Role } from "@shared/constants";
import { Brand } from "@/components/Brand";
import { LoadingState } from "@/components/Workspace";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { initials } from "@/lib/operations";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth";
import ChangePassword from "@/pages/ChangePassword";
import Login from "@/pages/Login";

// Pages load on demand to keep the first download small.
const Adhoc = lazy(() => import("@/pages/Adhoc"));
const Attendance = lazy(() => import("@/pages/Attendance"));
const BiometricDevices = lazy(() => import("@/pages/BiometricDevices"));
const AuditLog = lazy(() => import("@/pages/AuditLog"));
const DailyReports = lazy(() => import("@/pages/DailyReports"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const DutyRoster = lazy(() => import("@/pages/DutyRoster"));
const Employees = lazy(() => import("@/pages/Employees"));
const ErrorReports = lazy(() => import("@/pages/ErrorReports"));
const Leave = lazy(() => import("@/pages/Leave"));
import NotFound from "@/pages/NotFound";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; group: string; roles?: Role[] };

const NAVIGATION: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { to: "/reports", label: "Daily report", icon: FileText, group: "Operations" },
  { to: "/errors", label: "Error report", icon: CircleAlert, group: "Operations" },
  { to: "/roster", label: "Duty roster", icon: CalendarDays, group: "Operations" },
  { to: "/adhoc", label: "Ad-hoc process", icon: Clock3, group: "Time & people" },
  { to: "/leave", label: "Leave application", icon: UsersRound, group: "Time & people" },
  { to: "/attendance", label: "Punch matching", icon: Fingerprint, group: "Time & people", roles: ["admin", "manager"] },
  { to: "/devices", label: "Biometric devices", icon: Router, group: "Time & people", roles: ["admin", "manager"] },
  { to: "/employees", label: "Employees", icon: UserCog, group: "Administration", roles: ["admin"] },
  { to: "/audit", label: "Audit log", icon: ScrollText, group: "Administration", roles: ["admin"] },
];
const GROUPS = ["Workspace", "Operations", "Time & people", "Administration"];
const ROLE_LABEL: Record<Role, string> = { admin: "Administrator", manager: "Manager", employee: "Staff" };

export default function App() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <div className="min-h-dvh bg-[#f6f8fb]"><LoadingState label="Checking your session…" /></div>;

  if (!user) {
    return (
      <>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
        </Routes>
        <Toaster position="bottom-right" richColors closeButton />
      </>
    );
  }

  if (user.mustChangePassword) {
    return (
      <>
        <ChangePassword forced />
        <Toaster position="bottom-right" richColors closeButton />
      </>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/reports" element={<DailyReports />} />
        <Route path="/errors" element={<ErrorReports />} />
        <Route path="/roster" element={<DutyRoster />} />
        <Route path="/adhoc" element={<Adhoc />} />
        <Route path="/leave" element={<Leave />} />
        <Route path="/attendance" element={<RequireRole roles={["admin", "manager"]}><Attendance /></RequireRole>} />
        <Route path="/devices" element={<RequireRole roles={["admin", "manager"]}><BiometricDevices /></RequireRole>} />
        <Route path="/employees" element={<RequireRole roles={["admin"]}><Employees /></RequireRole>} />
        <Route path="/audit" element={<RequireRole roles={["admin"]}><AuditLog /></RequireRole>} />
        <Route path="/account/password" element={<ChangePassword />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Shell>
  );
}

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <NotFound forbidden />;
  return <>{children}</>;
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = NAVIGATION.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  const current = items.find((item) => (item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)));

  async function signOut() {
    await logout();
    navigate("/login", { replace: true });
  }

  const navContent = (mobile = false) => (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[76px] items-center border-b border-[#edf0f4] px-5"><Brand /></div>
      <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Main navigation">
        {GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (!groupItems.length) return null;
          return (
            <div key={group} className="mb-5">
              <div className="mb-2 px-3 font-mono text-[9px] font-medium uppercase tracking-[0.15em] text-[#98a2b3]">{group}</div>
              <div className="space-y-1">
                {groupItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) => cn("flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium transition-colors", isActive ? "bg-[#edf5ff] text-[#0053bf]" : "text-[#526174] hover:bg-[#f5f8fb] hover:text-[#1d2939]")}
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={cn("h-[17px] w-[17px]", isActive ? "text-[#0064e6]" : "text-[#7c8a9c]")} />
                          <span>{item.label}</span>
                          {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#0064e6]" />}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-[#edf0f4] p-4">
        <div className="flex items-center gap-3 rounded-lg bg-[#f8fafc] p-3">
          <ShieldCheck className="h-4 w-4 text-[#0064e6]" />
          <div>
            <div className="text-xs font-medium text-[#344054]">Signed in securely</div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#667085]">{user ? ROLE_LABEL[user.role] : ""} access</div>
          </div>
        </div>
        {mobile && <div className="mt-3 text-center font-mono text-[9px] uppercase tracking-widest text-[#98a2b3]">Infinity Solutions</div>}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#f6f8fb]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-[#e4e9f0] lg:block">{navContent()}</aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-[76px] items-center gap-3 border-b border-[#e4e9f0] bg-white/95 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></Button>
          <div className="lg:hidden"><Brand compact /></div>
          <div className="hidden min-w-0 lg:block">
            <div className="truncate text-sm font-semibold text-[#344054]">{current?.label ?? "Account"}</div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#98a2b3]">Infinity Solutions · Operations</div>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Button className="hidden sm:flex" variant="outline" onClick={() => navigate("/adhoc")}><Play className="h-3.5 w-3.5 fill-current" />Start ad-hoc</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg border border-[#e4e9f0] bg-white py-1.5 pl-2 pr-2 sm:pr-3" aria-label="Account menu">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#edf5ff] font-mono text-[10px] font-semibold text-[#0064e6]">{user ? initials(user.name) : "IS"}</div>
                  <div className="hidden text-left md:block">
                    <div className="max-w-44 truncate text-xs font-medium text-[#344054]">{user?.name}</div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-[#98a2b3]">{user ? ROLE_LABEL[user.role] : ""}</div>
                  </div>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-[#98a2b3] md:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{user?.name}</div>
                  <div className="font-mono text-[10px] font-normal text-[#667085]">{user?.employeeCode}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate("/account/password")}><KeyRound className="h-4 w-4" />Change password</DropdownMenuItem>
                <DropdownMenuItem onSelect={signOut} className="text-[#b42318] focus:text-[#b42318]"><LogOut className="h-4 w-4" />Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8"><Suspense fallback={<LoadingState />}>{children}</Suspense></main>
        <footer className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 pb-6 pt-2 text-[11px] text-[#98a2b3] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span className="flex items-center gap-1.5"><BarChart3 className="h-3 w-3" />Infinity Solutions · Internal operations workspace</span>
          <span className="font-mono uppercase tracking-wider">GAI · APEX · LOGWIN · BOLLORE</span>
        </footer>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[290px] p-0">
          <SheetTitle className="sr-only">Application navigation</SheetTitle>
          <SheetDescription className="sr-only">Navigate the Infinity Solutions operations portal</SheetDescription>
          {navContent(true)}
        </SheetContent>
      </Sheet>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
