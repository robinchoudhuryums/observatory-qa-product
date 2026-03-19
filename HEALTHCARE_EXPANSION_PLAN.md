# Observatory QA — Healthcare Expansion Plan

## Executive Summary

Observatory QA expands from call center QA into a combined **Call Quality Analysis + Clinical Documentation** platform for healthcare, starting with **dental practices** as the initial vertical. This plan leverages a confirmed gap in Epic's ecosystem (no native call QA), competitive weaknesses in existing AI scribe tools (Freed, Twofold, Nabla), and direct access to dental practices using Open Dental and Eaglesoft for beta testing.

---

## Market Opportunity

### Epic EHR Gap
Epic has **no native call quality monitoring, scoring, or speech analytics**. Their CRM (Cheers) handles patient engagement campaigns and call routing, but all QA capabilities come from third-party integrations (Webex, Zoom, Talkdesk) that provide only basic CSAT scoring — not deep AI analysis with coaching insights. Observatory QA fills this gap as "the QA intelligence layer alongside Epic Cheers."

### Competitor Weaknesses to Exploit

| Competitor | Price | Biggest Weakness | Our Advantage |
|---|---|---|---|
| **Freed AI** | $99-119/mo | Scribe-only, no real EHR API (Chrome scraping) | QA + docs combined, transparent pricing |
| **Twofold** | $49-69/mo | Zero EHR integration, no analytics | Full analytics dashboard, EHR integrations |
| **Nabla** | ~$119/mo (opaque) | Opaque pricing, limited customization | Transparent pricing, per-org custom templates |
| **All three** | — | No call QA, no coaching, no performance tracking | Complete QA + coaching + analytics platform |

### Competitor Strengths to Incorporate
- **Freed**: Self-learning style adaptation for clinical notes
- **Twofold**: Sub-30-second note generation, strong behavioral health templates
- **Nabla**: Native EHR integrations (our target with Open Dental/Eaglesoft), multilingual support

---

## Phase 1: Dental Practice QA (Months 1-3)

**Goal**: Validate product-market fit with family dental practices (Open Dental & Eaglesoft users).

### 1.1 Dental Call Categories
New call categories added to the platform:
- `dental_scheduling` — Appointment scheduling, rescheduling, cancellation calls
- `dental_insurance` — Insurance verification, benefits explanation, pre-authorization
- `dental_treatment` — Treatment plan discussion, acceptance, financial arrangements
- `dental_recall` — Recall/recare reminder calls, hygiene appointment booking
- `dental_emergency` — Emergency triage calls (toothache, trauma, swelling)
- `dental_encounter` — In-office clinical encounter (clinical documentation mode)
- `dental_consultation` — New patient consultation recording

### 1.2 Dental-Specific Prompt Templates
Default prompt templates for each dental call category, with:
- **Evaluation criteria** tailored to dental front desk workflows
- **Required phrases** (HIPAA verification, financial policy disclosure, emergency triage questions)
- **Scoring weights** emphasizing compliance and patient experience
- **Dental terminology** in additional instructions

### 1.3 Dental Scoring Criteria
Key performance indicators specific to dental:
- **Treatment acceptance rate correlation** — Track how call quality scores relate to case acceptance
- **Scheduling efficiency** — Did the front desk fill open slots, handle cancellations properly?
- **Insurance explanation clarity** — Did staff accurately explain coverage and patient responsibility?
- **Emergency triage compliance** — Were proper clinical questions asked before scheduling?
- **HIPAA compliance** — Patient identity verification, PHI handling

### 1.4 Dental RAG Vocabulary
Seed knowledge base documents for dental practices:
- ADA procedure codes (D-codes) reference
- Common dental insurance terminology and workflows
- Emergency triage protocols
- OSHA/HIPAA compliance requirements for dental offices
- Patient communication best practices (treatment acceptance scripts)

### 1.5 Clinical Documentation for Dental Encounters
Extend the clinical documentation system with dental-specific output:
- **Dental SOAP notes** — chief complaint, clinical findings, treatment rendered, plan
- **CDT codes** (dental procedure codes) instead of CPT
- **Tooth numbering** (Universal and Palmer notation)
- **Periodontal charting** integration points
- **Treatment plan documentation** with phased treatment support

---

## Phase 2: Clinical Documentation Add-On (Months 3-6)

**Goal**: Add AI scribe capabilities that complement call QA, creating a unique combined offering.

### 2.1 Core Scribe Features
- Real-time transcription of clinical encounters → structured notes
- Self-learning style adaptation (per-provider note preferences, inspired by Freed)
- Target: sub-30-second note generation (match Twofold's speed)
- SOAP, DAP, BIRP, and custom note formats
- Spanish language support as first non-English language

### 2.2 Dental-Specific Clinical Notes
- Periodontal examination documentation
- Operative/restorative procedure notes
- Endodontic treatment documentation
- Oral surgery notes
- Orthodontic progress notes
- Prosthodontic treatment plans
- CDT code suggestions (instead of CPT for dental)
- Tooth-specific findings with Universal numbering

### 2.3 Provider Dashboard
- Documentation completeness trends
- Average note generation time
- Code suggestion accuracy tracking
- Per-provider style preferences

---

## Phase 3: Dental EHR Integration (Months 6-9)

**Goal**: Solve the #1 pain point competitors can't — native EHR integration.

### 3.1 Open Dental Integration (Priority 1)
Open Dental is open-source with a well-documented REST API:
- **Patient record lookup** — auto-populate notes with patient demographics, allergies, medications
- **Appointment data** — provide call context (upcoming procedures, treatment history)
- **Clinical note push** — write completed notes directly into patient records
- **Treatment plan sync** — read/write treatment plans for call QA context
- **Referral tracking** — track specialist referrals from call recordings

### 3.2 Eaglesoft Integration (Priority 2)
Patterson's Eaglesoft (via eDex API):
- Patient demographics and insurance information
- Appointment scheduling integration
- Clinical note integration
- Treatment plan access

### 3.3 Integration Architecture
```
Observatory QA ←→ EHR Adapter Layer ←→ Open Dental API / Eaglesoft eDex
                                    ←→ (Future: Dentrix, Epic, etc.)
```
- Abstract EHR adapter interface supporting multiple backends
- Per-org EHR configuration (connection credentials, field mappings)
- Bidirectional sync with conflict resolution
- Audit logging for all EHR data access (HIPAA)

---

## Phase 4: Expand Verticals (Months 9-12)

**Goal**: Apply the dental playbook to adjacent healthcare markets.

### 4.1 Target Verticals (in priority order)
1. **Urgent care / walk-in clinics** — similar SMB profile, high call volume, simple EHRs
2. **Behavioral health** — underserved by Freed and Nabla; strong Twofold segment to capture
3. **Dermatology / ophthalmology** — high-volume specialty practices
4. **Veterinary** — zero HIPAA burden, simpler compliance, no current competitors

### 4.2 Vertical Expansion Checklist (per vertical)
- [ ] Specialty-specific call categories
- [ ] Default prompt templates with industry terminology
- [ ] Clinical documentation templates (note formats, code sets)
- [ ] RAG seed documents (protocols, compliance requirements)
- [ ] EHR integrations for the vertical's dominant systems
- [ ] Beta practice partnerships

---

## Pricing Strategy

| Plan | Price | Target | Features |
|---|---|---|---|
| **QA Only** (current) | $99/mo | Front desk / call center QA | Call analysis, scoring, coaching, analytics |
| **Docs Only** | $49/mo | Clinical documentation | AI scribe, note generation, coding suggestions |
| **QA + Docs** | $129/mo | Full platform | Everything combined (unique in market) |
| **Enterprise** | $499/mo | Multi-location practices | SSO, unlimited usage, custom integrations, API access |

All plans include transparent, public pricing — a direct competitive advantage over Nabla.

---

## Competitive Positioning

**Tagline**: "The only platform that scores your front desk calls AND generates your clinical notes."

### Unique Differentiators
1. **Combined QA + clinical documentation** — no competitor offers both
2. **Coaching and performance tracking** — built-in, not bolt-on
3. **Analytics dashboards** — none of the three competitors have this
4. **RAG knowledge base** — grounded in each practice's own protocols and documentation
5. **Transparent pricing** — public pricing page, free tier for evaluation
6. **Dental-first specialization** — zero competition in this niche
7. **Native EHR integration** starting with Open Dental (open-source, free to integrate)

### Against Specific Competitors
- **vs. Freed**: "We do everything Freed does, plus score your front desk and coach your team"
- **vs. Twofold**: "Same speed, plus EHR integration, analytics, and call QA"
- **vs. Nabla**: "Transparent pricing, dental specialization, and call quality analysis they don't offer"

---

## Technical Implementation Summary

### Schema Changes
- New dental call categories in `CALL_CATEGORIES`
- New dental clinical specialties in `CLINICAL_SPECIALTIES`
- New dental note format in `CLINICAL_NOTE_FORMATS`
- CDT code schema (dental-specific procedure codes)

### AI Provider Changes
- Dental-specific `CATEGORY_CONTEXT` entries for AI prompt building
- Dental clinical documentation system prompt (CDT codes, tooth numbering)
- Category routing: dental encounter categories → dental clinical documentation mode

### New Services
- `server/services/ehr/` — EHR adapter interface and implementations
- `server/services/ehr/open-dental.ts` — Open Dental API client
- `server/services/ehr/eaglesoft.ts` — Eaglesoft eDex client

### RAG Seed Data
- `data/dental/` — dental terminology, ADA codes, triage protocols, compliance docs

---

## Success Metrics

### Phase 1 (Dental QA)
- 2+ dental practices actively using the platform
- Treatment acceptance rate tracking operational
- Dental-specific prompt templates validated with real calls
- NPS > 40 from beta practices

### Phase 2 (Clinical Docs)
- Average note generation time < 30 seconds
- Provider satisfaction > 80% (notes require minimal editing)
- Clinical documentation completeness score > 8.0/10

### Phase 3 (EHR Integration)
- Open Dental bidirectional sync operational
- Eaglesoft read integration operational
- Zero PHI data leakage incidents

### Phase 4 (Vertical Expansion)
- 2+ additional verticals launched
- 50+ practices across all verticals
- Revenue growth trajectory supporting Series A readiness
