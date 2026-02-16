"use client";

import { useMembers } from "@repo/hooks";

export default function MembersPage() {
  const { data: members, isLoading, error } = useMembers();

  if (isLoading) return <div>Loading members...</div>;
  if (error) return <div>Error loading members: {error.message}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Members</h2>
        <p className="text-muted-foreground">
          View and manage the members of your chapter.
        </p>
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground font-medium border-b text-left">
            <tr>
              <th className="p-4">User ID</th>
              <th className="p-4">Roles</th>
              <th className="p-4">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {members?.map((member) => (
              <tr key={member.id} className="hover:bg-muted/50 transition-colors">
                <td className="p-4 font-mono text-xs">{member.userId}</td>
                <td className="p-4">
                  <div className="flex gap-1 flex-wrap">
                    {member.roleIds.length > 0 ? (
                      member.roleIds.map((roleId) => (
                        <span 
                          key={roleId} 
                          className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[10px] font-bold"
                        >
                          {roleId}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground text-xs italic">No roles assigned</span>
                    )}
                  </div>
                </td>
                <td className="p-4 text-muted-foreground">
                  {new Date(member.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {members?.length === 0 && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-muted-foreground">
                  No members found in this chapter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
