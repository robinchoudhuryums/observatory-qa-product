import { Button } from "@/components/ui/button";
import {
  BarChart3, Shield, Users, TrendingUp,
  Mic, Brain, FileText, Zap, ArrowRight, ChevronRight,
} from "lucide-react";
import { ObservatoryLogo } from "@/components/observatory-logo";

interface LandingPageProps {
  onNavigate: (view: "login" | "register") => void;
}

/** Animated flowing wave lines — SVG-based, CSS-animated */
function WaveBackground() {
  // Generate wave paths with varying amplitudes and phases
  const waves = Array.from({ length: 18 }, (_, i) => {
    const yBase = 150 + i * 22;
    const amplitude = 60 + Math.sin(i * 0.7) * 30;
    const phase = i * 25;
    const opacity = 0.08 + (i / 18) * 0.18;
    // Gradient from teal to rose across wave set
    const hue = 170 + (i / 18) * 160; // 170 (teal) → 330 (rose)
    const saturation = 70 + Math.sin(i * 0.5) * 20;

    const d = `M-100,${yBase} C200,${yBase - amplitude + phase * 0.1} 400,${yBase + amplitude - phase * 0.05} 600,${yBase} C800,${yBase - amplitude * 0.7} 1000,${yBase + amplitude * 0.5} 1200,${yBase} C1400,${yBase - amplitude * 0.3} 1600,${yBase + amplitude * 0.8} 2000,${yBase}`;

    return (
      <path
        key={i}
        d={d}
        fill="none"
        stroke={`hsl(${hue}, ${saturation}%, 60%)`}
        strokeWidth="1"
        opacity={opacity}
        className="wave-line"
        style={{
          animationDelay: `${i * 0.3}s`,
          animationDuration: `${8 + i * 0.5}s`,
        }}
      />
    );
  });

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg
        viewBox="0 0 1200 600"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
      >
        {waves}
      </svg>
    </div>
  );
}

/** Glowing gradient orb for ambient lighting */
function GlowOrb({ className }: { className?: string }) {
  return (
    <div
      className={`absolute rounded-full blur-3xl pointer-events-none ${className}`}
    />
  );
}

const FEATURES = [
  {
    icon: Mic,
    title: "Auto Transcription",
    description: "Upload call recordings and get accurate transcripts powered by AssemblyAI in minutes.",
    gradient: "from-teal-500 to-cyan-500",
  },
  {
    icon: Brain,
    title: "AI Analysis",
    description: "Claude analyzes every call for sentiment, compliance, performance scores, and coaching opportunities.",
    gradient: "from-blue-500 to-indigo-500",
  },
  {
    icon: BarChart3,
    title: "Performance Dashboards",
    description: "Real-time metrics, trend analysis, and team performance tracking with interactive charts.",
    gradient: "from-indigo-500 to-purple-500",
  },
  {
    icon: Shield,
    title: "Compliance Monitoring",
    description: "Custom evaluation criteria, required phrase detection, and automated compliance flagging.",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    icon: Users,
    title: "Team Coaching",
    description: "AI-generated coaching recommendations, review queues, and effectiveness tracking.",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    icon: TrendingUp,
    title: "Proactive Insights",
    description: "Weekly digests, Slack/Teams alerts, and trend detection that surfaces issues before they escalate.",
    gradient: "from-rose-500 to-orange-500",
  },
];

const STEPS = [
  { step: "1", icon: Mic, title: "Upload", desc: "Upload call recordings in any audio format" },
  { step: "2", icon: FileText, title: "Transcribe", desc: "Automatic transcription with speaker detection" },
  { step: "3", icon: Brain, title: "Analyze", desc: "AI scores performance, compliance, and sentiment" },
  { step: "4", icon: Zap, title: "Act", desc: "Get coaching insights and track improvements" },
];

const PLANS = [
  { name: "Free", price: "$0", period: "/mo", calls: "50 calls/mo", highlight: false },
  { name: "Pro", price: "$99", period: "/mo", calls: "1,000 calls/mo", highlight: true },
  { name: "Enterprise", price: "$499", period: "/mo", calls: "Unlimited calls", highlight: false },
];

export default function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <div className="min-h-screen landing-page">
      {/* ── Hero Section ─────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col overflow-hidden landing-hero">
        <WaveBackground />

        {/* Ambient glow */}
        <GlowOrb className="w-96 h-96 bg-teal-500/10 dark:bg-teal-500/5 top-20 -right-20" />
        <GlowOrb className="w-80 h-80 bg-rose-500/10 dark:bg-rose-500/5 bottom-20 right-1/4" />
        <GlowOrb className="w-64 h-64 bg-blue-500/8 dark:bg-blue-500/5 top-1/3 left-10" />

        {/* Nav */}
        <header className="relative z-10 w-full">
          <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ObservatoryLogo variant="full" height={32} hoverable className="landing-text" />
            </div>
            <nav className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm landing-text-muted hover:text-foreground transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm landing-text-muted hover:text-foreground transition-colors">How it Works</a>
              <a href="#pricing" className="text-sm landing-text-muted hover:text-foreground transition-colors">Pricing</a>
            </nav>
            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={() => onNavigate("login")}
                className="landing-text-muted hover:text-foreground"
              >
                Sign In
              </Button>
              <Button
                onClick={() => onNavigate("register")}
                className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white border-0 shadow-lg shadow-teal-500/20"
              >
                Get Started
              </Button>
            </div>
          </div>
        </header>

        {/* Hero content */}
        <div className="relative z-10 flex-1 flex items-center">
          <div className="max-w-7xl mx-auto px-6 w-full">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 bg-teal-500/10 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 text-sm font-medium px-4 py-1.5 rounded-full mb-6 border border-teal-500/20">
                <Shield className="w-3.5 h-3.5" />
                HIPAA-Compliant
              </div>

              <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-[1.1] tracking-tight">
                <span className="landing-text">AI-Powered</span>{" "}
                <span className="bg-gradient-to-r from-teal-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Call Quality
                </span>
                <br />
                <span className="landing-text">Analysis</span>
              </h1>

              <p className="text-lg landing-text-muted max-w-xl mb-10 leading-relaxed">
                Automatically transcribe, analyze, and score every customer call.
                Get actionable coaching insights, compliance monitoring, and
                performance tracking — all in one platform.
              </p>

              <div className="flex flex-wrap gap-4">
                <Button
                  size="lg"
                  onClick={() => onNavigate("register")}
                  className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white border-0 shadow-lg shadow-teal-500/25 px-8 h-12 text-base"
                >
                  Start Free Trial
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => onNavigate("login")}
                  className="landing-outline-btn h-12 text-base px-8"
                >
                  Sign In
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="relative z-10 pb-8 text-center">
          <div className="inline-flex flex-col items-center gap-2 landing-text-muted text-xs tracking-widest uppercase">
            <span>Scroll</span>
            <div className="w-px h-8 bg-gradient-to-b from-current to-transparent" />
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────── */}
      <section id="features" className="relative py-24 landing-section">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-teal-500 dark:text-teal-400 tracking-widest uppercase mb-3">Features</p>
            <h2 className="text-3xl md:text-4xl font-bold landing-text mb-4">
              Everything you need for call quality
            </h2>
            <p className="landing-text-muted max-w-2xl mx-auto">
              From automated transcription to AI-powered coaching, Observatory gives your team
              the tools to deliver consistently excellent customer experiences.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="group relative p-6 rounded-2xl landing-card transition-all duration-300 hover:-translate-y-1"
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                  <feature.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-lg landing-text mb-2">{feature.title}</h3>
                <p className="text-sm landing-text-muted leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────── */}
      <section id="how-it-works" className="relative py-24 landing-section-alt">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-teal-500 dark:text-teal-400 tracking-widest uppercase mb-3">Process</p>
            <h2 className="text-3xl md:text-4xl font-bold landing-text">How it works</h2>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            {STEPS.map((item, i) => (
              <div key={item.step} className="relative text-center group">
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-px bg-gradient-to-r from-teal-500/30 to-transparent" />
                )}

                <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500/10 to-blue-500/10 dark:from-teal-500/10 dark:to-blue-500/10 border border-teal-500/20 mb-4 group-hover:scale-110 transition-transform">
                  <span className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-blue-400 bg-clip-text text-transparent">
                    {item.step}
                  </span>
                </div>
                <h3 className="font-semibold landing-text mb-1">{item.title}</h3>
                <p className="text-sm landing-text-muted">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────── */}
      <section id="pricing" className="relative py-24 landing-section">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-teal-500 dark:text-teal-400 tracking-widest uppercase mb-3">Pricing</p>
            <h2 className="text-3xl md:text-4xl font-bold landing-text mb-4">
              Simple, transparent pricing
            </h2>
            <p className="landing-text-muted">No credit card required. Start analyzing calls today.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative p-8 rounded-2xl text-center transition-all duration-300 hover:-translate-y-1 ${
                  plan.highlight
                    ? "bg-gradient-to-b from-teal-500/10 to-blue-500/5 dark:from-teal-500/10 dark:to-blue-500/5 border-2 border-teal-500/30 shadow-xl shadow-teal-500/10"
                    : "landing-card"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-gradient-to-r from-teal-500 to-blue-500 text-white text-xs font-semibold rounded-full">
                    Most Popular
                  </div>
                )}
                <h3 className="font-semibold text-lg landing-text mb-2">{plan.name}</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold landing-text">{plan.price}</span>
                  <span className="landing-text-muted">{plan.period}</span>
                </div>
                <p className="text-sm landing-text-muted mb-6">{plan.calls}</p>
                <Button
                  className={`w-full ${
                    plan.highlight
                      ? "bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white border-0"
                      : "landing-outline-btn"
                  }`}
                  variant={plan.highlight ? "default" : "outline"}
                  onClick={() => onNavigate("register")}
                >
                  {plan.highlight ? "Start Free Trial" : "Get Started"}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-teal-500/5 via-blue-500/5 to-purple-500/5 dark:from-teal-500/5 dark:via-blue-500/3 dark:to-purple-500/5" />
        <GlowOrb className="w-96 h-96 bg-teal-500/10 dark:bg-teal-500/5 -top-20 left-1/4" />
        <GlowOrb className="w-80 h-80 bg-blue-500/10 dark:bg-blue-500/5 -bottom-20 right-1/4" />

        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold landing-text mb-4">
            Ready to improve your team's call quality?
          </h2>
          <p className="landing-text-muted mb-10 max-w-xl mx-auto text-lg">
            Set up your organization in under 2 minutes. Start with 50 free calls per month.
          </p>
          <Button
            size="lg"
            onClick={() => onNavigate("register")}
            className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white border-0 shadow-lg shadow-teal-500/25 px-10 h-13 text-base"
          >
            Create Your Organization
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────── */}
      <footer className="py-8 landing-footer">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ObservatoryLogo variant="full" height={24} className="landing-text" />
          </div>
          <p className="text-xs landing-text-muted text-center">
            HIPAA-compliant call analysis platform. Your data is encrypted at rest and in transit.
          </p>
          <div className="flex gap-6">
            <a href="#features" className="text-xs landing-text-muted hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="text-xs landing-text-muted hover:text-foreground transition-colors">Pricing</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
