"use client";

import { useMemo, useState } from "react";
import { GraduationCap, Search } from "lucide-react";
import { useAlumni } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import { useNetwork } from "@/lib/providers/network-provider";
import { useChapterStore } from "@/lib/stores/chapter-store";

type AlumniRow = {
  id: string;
  user_id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  graduation_year: number | null;
  current_city: string | null;
  current_company: string | null;
  email: string | null;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("") || "?";
}

export function AlumniDirectory() {
  const { isOffline } = useNetwork();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);

  const [graduationYear, setGraduationYear] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [committed, setCommitted] = useState<{
    graduation_year?: string;
    city?: string;
    company?: string;
  }>({});

  const query = useAlumni({
    graduation_year: committed.graduation_year,
    city: committed.city,
    company: committed.company,
  });

  const alumni = useMemo(
    () => asArray<AlumniRow>(query.data),
    [query.data],
  );

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      graduation_year: graduationYear.trim() || undefined,
      city: cityFilter.trim() || undefined,
      company: companyFilter.trim() || undefined,
    };
    setCommitted(next);
  }

  function clearFilters() {
    setGraduationYear("");
    setCityFilter("");
    setCompanyFilter("");
    setCommitted({});
  }

  if (!activeChapterId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Alumni directory</CardTitle>
          <CardDescription>
            Select an active chapter to browse alumni records.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isOffline) {
    return (
      <OfflineState
        title="Alumni directory unavailable offline"
        description="Reconnect to load alumni records and filters."
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xl">Alumni directory</CardTitle>
            <CardDescription>
              Searchable list of alumni brothers with optional self-reported
              graduation year, city, and company fields.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-4"
            onSubmit={applyFilters}
            aria-label="Filter alumni"
          >
            <div className="grid gap-1">
              <label
                htmlFor="alumni-grad-year"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Graduation year
              </label>
              <Input
                id="alumni-grad-year"
                value={graduationYear}
                onChange={(event) => setGraduationYear(event.target.value)}
                placeholder="e.g. 2018"
                inputMode="numeric"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="alumni-city"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                City
              </label>
              <Input
                id="alumni-city"
                value={cityFilter}
                onChange={(event) => setCityFilter(event.target.value)}
                placeholder="Austin, Chicago, …"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="alumni-company"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Company
              </label>
              <Input
                id="alumni-company"
                value={companyFilter}
                onChange={(event) => setCompanyFilter(event.target.value)}
                placeholder="Employer or industry"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" className="gap-2">
                <Search className="h-4 w-4" />
                Apply filters
              </Button>
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {query.isPending ? (
        <LoadingState message="Loading alumni directory..." />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load alumni"
          description="Confirm your chapter access and retry. Alumni visibility respects the same permission checks as the member directory."
          onRetry={() => void query.refetch()}
        />
      ) : alumni.length === 0 ? (
        <EmptyState
          title="No alumni match this view"
          description="Ask alumni to fill in their graduation year, city, and company on their profile, or loosen the filters above."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {alumni.map((alum) => {
            const id = alum.id ?? alum.user_id;
            const name = alum.display_name ?? "Unnamed alum";
            const primaryLine = alum.graduation_year
              ? `Class of ${alum.graduation_year}`
              : "Graduation year not listed";
            const secondaryLine = [alum.current_company, alum.current_city]
              .filter((value): value is string => Boolean(value))
              .join(" • ");
            return (
              <Card key={id} className="border-border">
                <CardContent className="flex items-start gap-3 pt-6">
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {alum.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={alum.avatar_url}
                        alt=""
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <span aria-hidden="true">{initials(alum.display_name)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{name}</p>
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <GraduationCap className="h-3 w-3" /> Alumni
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{primaryLine}</p>
                    {secondaryLine ? (
                      <p className="text-xs text-muted-foreground">
                        {secondaryLine}
                      </p>
                    ) : null}
                    {alum.bio ? (
                      <p className="mt-2 line-clamp-3 text-xs text-foreground/80">
                        {alum.bio}
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
