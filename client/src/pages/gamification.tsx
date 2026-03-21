import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Trophy, Medal, Flame, Star, Target, TrendingUp, Award, Zap, BookOpen,
  Phone, PhoneForwarded, RefreshCw, ClipboardCheck,
} from "lucide-react";
import { useState } from "react";
import { BADGE_DEFINITIONS, type BadgeDefinition, type Employee } from "@shared/schema";

type LeaderboardEntry = {
  employeeId: string;
  employeeName: string;
  totalPoints: number;
  currentStreak: number;
  badgeCount: number;
  rank: number;
  level: number;
};

type GamificationProfile = {
  employeeId: string;
  employeeName: string;
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  level: number;
  badges: Array<BadgeDefinition & { awardedAt: string; awardedFor?: string }>;
  availableBadges: BadgeDefinition[];
};

const iconMap: Record<string, typeof Trophy> = {
  phone: Phone, "phone-forwarded": PhoneForwarded, trophy: Trophy, star: Star,
  award: Award, target: Target, "trending-up": TrendingUp, "refresh-cw": RefreshCw,
  "clipboard-check": ClipboardCheck, "book-open": BookOpen, flame: Flame, zap: Zap,
};

function BadgeDisplay({ badge, earned = true }: { badge: BadgeDefinition & { awardedAt?: string }; earned?: boolean }) {
  const Icon = iconMap[badge.icon] || Award;
  return (
    <div className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-center ${earned ? "bg-background" : "bg-muted/50 opacity-50"}`}>
      <div className={`p-2 rounded-full ${earned ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
        <Icon className="w-6 h-6" />
      </div>
      <p className="text-xs font-medium">{badge.name}</p>
      <p className="text-[10px] text-muted-foreground">{badge.description}</p>
      {earned && badge.awardedAt && (
        <p className="text-[10px] text-muted-foreground">{new Date(badge.awardedAt).toLocaleDateString()}</p>
      )}
    </div>
  );
}

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <Medal className="w-5 h-5 text-yellow-500" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-700" />;
  return <span className="text-sm font-medium text-muted-foreground w-5 text-center">{rank}</span>;
}

export default function GamificationPage() {
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");

  const { data: leaderboard = [] } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/gamification/leaderboard"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: profile } = useQuery<GamificationProfile>({
    queryKey: ["/api/gamification/profile", selectedEmployee],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!selectedEmployee,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Trophy className="w-6 h-6 text-primary" />
          Leaderboard & Achievements
        </h1>
        <p className="text-muted-foreground">Track performance, earn badges, and compete on the leaderboard</p>
      </div>

      <Tabs defaultValue="leaderboard">
        <TabsList>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="badges">Badges</TabsTrigger>
          <TabsTrigger value="profile">Employee Profile</TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboard" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization Leaderboard</CardTitle>
              <CardDescription>Top performers ranked by points</CardDescription>
            </CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No leaderboard data yet. Points are earned as calls are processed and reviewed.
                </p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry) => (
                    <div key={entry.employeeId}
                      className={`flex items-center gap-4 p-3 rounded-lg border ${entry.rank <= 3 ? "bg-primary/5" : ""}`}
                      onClick={() => setSelectedEmployee(entry.employeeId)}
                      role="button"
                    >
                      <RankMedal rank={entry.rank} />
                      <div className="flex-1">
                        <p className="font-medium">{entry.employeeName}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>Level {entry.level}</span>
                          <span className="flex items-center gap-1">
                            <Award className="w-3 h-3" /> {entry.badgeCount} badges
                          </span>
                          {entry.currentStreak > 0 && (
                            <span className="flex items-center gap-1 text-orange-500">
                              <Flame className="w-3 h-3" /> {entry.currentStreak} day streak
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{entry.totalPoints.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">points</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="badges" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Available Badges</CardTitle>
              <CardDescription>Achievements employees can earn</CardDescription>
            </CardHeader>
            <CardContent>
              {(["milestone", "performance", "improvement", "engagement", "streak"] as const).map(category => {
                const badges = BADGE_DEFINITIONS.filter(b => b.category === category);
                if (badges.length === 0) return null;
                return (
                  <div key={category} className="mb-6">
                    <h3 className="text-sm font-medium mb-3 capitalize">{category}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {badges.map(badge => (
                        <BadgeDisplay key={badge.id} badge={badge} earned={false} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile" className="space-y-4">
          <div className="flex items-center gap-4">
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Select an employee..." />
              </SelectTrigger>
              <SelectContent>
                {employees.map(e => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {profile && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Points</CardDescription>
                    <CardTitle className="text-3xl">{profile.totalPoints.toLocaleString()}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">Level {profile.level}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Current Streak</CardDescription>
                    <CardTitle className="text-3xl flex items-center gap-2">
                      {profile.currentStreak}
                      {profile.currentStreak > 0 && <Flame className="w-6 h-6 text-orange-500" />}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">days</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Longest Streak</CardDescription>
                    <CardTitle className="text-3xl">{profile.longestStreak}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">days</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Badges Earned</CardDescription>
                    <CardTitle className="text-3xl">{profile.badges.length}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">of {BADGE_DEFINITIONS.length}</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Earned Badges</CardTitle>
                </CardHeader>
                <CardContent>
                  {profile.badges.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No badges earned yet</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {profile.badges.map(badge => (
                        <BadgeDisplay key={badge.id} badge={badge} earned={true} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {profile.availableBadges.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Badges to Earn</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {profile.availableBadges.map(badge => (
                        <BadgeDisplay key={badge.id} badge={badge} earned={false} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
