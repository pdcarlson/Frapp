import { currentUser } from "@clerk/nextjs/server";

export default async function DashboardPage() {
  const user = await currentUser();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Welcome back, {user?.firstName}!</h2>
        <p className="text-muted-foreground">
          Here is what's happening with your chapter today.
        </p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card text-card-foreground shadow">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Total Members</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">--</div>
            <p className="text-xs text-muted-foreground">+0% from last month</p>
          </div>
        </div>
        
        <div className="rounded-xl border bg-card text-card-foreground shadow">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Active Events</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">--</div>
            <p className="text-xs text-muted-foreground">Next event in 2 days</p>
          </div>
        </div>

        <div className="rounded-xl border bg-card text-card-foreground shadow">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Pending Dues</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">$0.00</div>
            <p className="text-xs text-muted-foreground">Across -- invoices</p>
          </div>
        </div>

        <div className="rounded-xl border bg-card text-card-foreground shadow">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Study Hours</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">Total house hours this week</p>
          </div>
        </div>
      </div>
    </div>
  );
}
