import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { DashboardContent } from "@/components/app/dashboard-content";

export default function AppLandingDashboard() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <Topbar />
          <main>
            <DashboardContent />
          </main>
        </div>
      </div>
    </div>
  );
}
