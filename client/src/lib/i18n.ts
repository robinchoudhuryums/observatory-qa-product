/**
 * Internationalization (i18n) System
 *
 * Supports English (default) and Spanish.
 * Uses a simple key-based lookup with nested namespaces.
 *
 * Usage:
 *   import { t, setLocale, getLocale } from "@/lib/i18n";
 *   t("nav.dashboard")  // "Dashboard" or "Panel de Control"
 *
 * Interpolation:
 *   t("calls.count", { count: 5 })  // "5 calls" or "5 llamadas"
 */

export type Locale = "en" | "es";

type TranslationMap = Record<string, string | Record<string, string>>;

const translations: Record<Locale, TranslationMap> = {
  en: {
    // Navigation
    "nav.dashboard": "Dashboard",
    "nav.upload": "Upload Calls",
    "nav.transcripts": "Transcripts",
    "nav.search": "Search",
    "nav.sentiment": "Sentiment",
    "nav.performance": "Performance",
    "nav.reports": "Reports",
    "nav.insights": "Insights",
    "nav.employees": "Employees",
    "nav.coaching": "Coaching",
    "nav.admin": "Administration",
    "nav.settings": "Settings",
    "nav.clinical": "Clinical",
    "nav.templates": "Templates",
    "nav.ab_testing": "A/B Testing",
    "nav.spend": "Spend Tracking",

    // Auth
    "auth.login": "Log In",
    "auth.logout": "Log Out",
    "auth.username": "Username",
    "auth.password": "Password",
    "auth.register": "Register",
    "auth.forgot_password": "Forgot Password?",
    "auth.mfa_required": "Enter your MFA code",

    // Dashboard
    "dashboard.total_calls": "Total Calls",
    "dashboard.avg_score": "Avg Performance",
    "dashboard.sentiment_dist": "Sentiment Distribution",
    "dashboard.top_performers": "Top Performers",
    "dashboard.recent_calls": "Recent Calls",
    "dashboard.flagged_calls": "Flagged Calls",

    // Calls
    "calls.upload": "Upload Call",
    "calls.status.processing": "Processing",
    "calls.status.completed": "Completed",
    "calls.status.failed": "Failed",
    "calls.no_calls": "No calls found",
    "calls.delete_confirm": "Are you sure you want to delete this call?",

    // Analysis
    "analysis.performance_score": "Performance Score",
    "analysis.compliance": "Compliance",
    "analysis.customer_experience": "Customer Experience",
    "analysis.communication": "Communication",
    "analysis.resolution": "Resolution",
    "analysis.strengths": "Strengths",
    "analysis.suggestions": "Suggestions",
    "analysis.action_items": "Action Items",
    "analysis.flags": "Flags",

    // Sentiment
    "sentiment.positive": "Positive",
    "sentiment.neutral": "Neutral",
    "sentiment.negative": "Negative",

    // Employees
    "employees.add": "Add Employee",
    "employees.import_csv": "Import CSV",
    "employees.name": "Name",
    "employees.email": "Email",
    "employees.role": "Role",
    "employees.status": "Status",

    // Coaching
    "coaching.create": "Create Session",
    "coaching.action_plan": "Action Plan",
    "coaching.status.active": "Active",
    "coaching.status.completed": "Completed",

    // Clinical
    "clinical.notes": "Clinical Notes",
    "clinical.attestation": "Attestation",
    "clinical.attest": "Attest Note",
    "clinical.consent": "Patient Consent",
    "clinical.completeness": "Documentation Completeness",
    "clinical.accuracy": "Clinical Accuracy",

    // Common
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.loading": "Loading...",
    "common.error": "An error occurred",
    "common.success": "Success",
    "common.confirm": "Confirm",
    "common.search": "Search",
    "common.filter": "Filter",
    "common.export": "Export",
    "common.date_range": "Date Range",
    "common.no_data": "No data available",
  },

  es: {
    // Navigation
    "nav.dashboard": "Panel de Control",
    "nav.upload": "Subir Llamadas",
    "nav.transcripts": "Transcripciones",
    "nav.search": "Buscar",
    "nav.sentiment": "Sentimiento",
    "nav.performance": "Rendimiento",
    "nav.reports": "Informes",
    "nav.insights": "Perspectivas",
    "nav.employees": "Empleados",
    "nav.coaching": "Coaching",
    "nav.admin": "Administración",
    "nav.settings": "Configuración",
    "nav.clinical": "Clínico",
    "nav.templates": "Plantillas",
    "nav.ab_testing": "Pruebas A/B",
    "nav.spend": "Seguimiento de Gastos",

    // Auth
    "auth.login": "Iniciar Sesión",
    "auth.logout": "Cerrar Sesión",
    "auth.username": "Nombre de Usuario",
    "auth.password": "Contraseña",
    "auth.register": "Registrarse",
    "auth.forgot_password": "¿Olvidaste tu Contraseña?",
    "auth.mfa_required": "Ingresa tu código MFA",

    // Dashboard
    "dashboard.total_calls": "Total de Llamadas",
    "dashboard.avg_score": "Rendimiento Promedio",
    "dashboard.sentiment_dist": "Distribución de Sentimiento",
    "dashboard.top_performers": "Mejores Agentes",
    "dashboard.recent_calls": "Llamadas Recientes",
    "dashboard.flagged_calls": "Llamadas Marcadas",

    // Calls
    "calls.upload": "Subir Llamada",
    "calls.status.processing": "Procesando",
    "calls.status.completed": "Completada",
    "calls.status.failed": "Fallida",
    "calls.no_calls": "No se encontraron llamadas",
    "calls.delete_confirm": "¿Estás seguro de que deseas eliminar esta llamada?",

    // Analysis
    "analysis.performance_score": "Puntuación de Rendimiento",
    "analysis.compliance": "Cumplimiento",
    "analysis.customer_experience": "Experiencia del Cliente",
    "analysis.communication": "Comunicación",
    "analysis.resolution": "Resolución",
    "analysis.strengths": "Fortalezas",
    "analysis.suggestions": "Sugerencias",
    "analysis.action_items": "Acciones a Seguir",
    "analysis.flags": "Alertas",

    // Sentiment
    "sentiment.positive": "Positivo",
    "sentiment.neutral": "Neutral",
    "sentiment.negative": "Negativo",

    // Employees
    "employees.add": "Agregar Empleado",
    "employees.import_csv": "Importar CSV",
    "employees.name": "Nombre",
    "employees.email": "Correo Electrónico",
    "employees.role": "Rol",
    "employees.status": "Estado",

    // Coaching
    "coaching.create": "Crear Sesión",
    "coaching.action_plan": "Plan de Acción",
    "coaching.status.active": "Activa",
    "coaching.status.completed": "Completada",

    // Clinical
    "clinical.notes": "Notas Clínicas",
    "clinical.attestation": "Certificación",
    "clinical.attest": "Certificar Nota",
    "clinical.consent": "Consentimiento del Paciente",
    "clinical.completeness": "Completitud de Documentación",
    "clinical.accuracy": "Precisión Clínica",

    // Common
    "common.save": "Guardar",
    "common.cancel": "Cancelar",
    "common.delete": "Eliminar",
    "common.edit": "Editar",
    "common.loading": "Cargando...",
    "common.error": "Ocurrió un error",
    "common.success": "Éxito",
    "common.confirm": "Confirmar",
    "common.search": "Buscar",
    "common.filter": "Filtrar",
    "common.export": "Exportar",
    "common.date_range": "Rango de Fechas",
    "common.no_data": "Sin datos disponibles",
  },
};

// --- State ---
let currentLocale: Locale = "en";

// Try to restore from localStorage
if (typeof window !== "undefined") {
  const saved = localStorage.getItem("observatory-locale");
  if (saved === "en" || saved === "es") {
    currentLocale = saved;
  }
}

/**
 * Translate a key. Supports interpolation: t("key", { count: 5 })
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = translations[currentLocale];
  let value = dict[key];

  if (typeof value === "object") return key; // Nested namespace, shouldn't happen with flat keys
  if (!value) {
    // Fallback to English
    value = translations.en[key] as string;
    if (!value) return key; // Key not found
  }

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{${k}}`, String(v));
    }
  }

  return value;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof window !== "undefined") {
    localStorage.setItem("observatory-locale", locale);
  }
}

export function getLocale(): Locale {
  return currentLocale;
}

export function getAvailableLocales(): { code: Locale; label: string }[] {
  return [
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
  ];
}
