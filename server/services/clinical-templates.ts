/**
 * Clinical Note Templates Library
 *
 * Pre-built templates per medical/dental specialty that providers can use
 * as starting points for their documentation.
 */

export interface ClinicalNoteTemplate {
  id: string;
  name: string;
  specialty: string;
  format: string;
  category: string;
  description: string;
  sections: Record<string, string>;
  defaultCodes?: Array<{ code: string; description: string }>;
  tags: string[];
}

export const CLINICAL_NOTE_TEMPLATES: ClinicalNoteTemplate[] = [
  // ==================== GENERAL MEDICAL ====================
  {
    id: "annual-physical",
    name: "Annual Physical / Wellness Visit",
    specialty: "primary_care",
    format: "soap",
    category: "preventive",
    description: "Comprehensive annual wellness exam with preventive screening review and health maintenance counseling.",
    sections: {
      subjective: "Patient presents for annual wellness exam. {{chief_complaint}}. Review of systems: {{review_of_systems}}. Current medications: {{medications}}. Allergies: {{allergies}}. Social history: {{social_history}}. Family history: {{family_history}}.",
      objective: "Vitals: BP {{bp}}, HR {{hr}}, Temp {{temp}}, SpO2 {{spo2}}, Weight {{weight}}, Height {{height}}, BMI {{bmi}}. General: Well-appearing, no acute distress. HEENT: Normocephalic, PERRL, oropharynx clear. Neck: Supple, no lymphadenopathy. Cardiovascular: RRR, no murmurs. Lungs: CTA bilaterally. Abdomen: Soft, non-tender, non-distended. Extremities: No edema. Skin: No suspicious lesions. Neuro: A&Ox4, grossly intact.",
      assessment: "{{assessment}}. Preventive care: {{screenings_due}}.",
      plan: "1. {{preventive_orders}}\n2. Immunizations: {{vaccines}}\n3. Lab work: {{labs_ordered}}\n4. Follow-up: {{follow_up}}",
    },
    defaultCodes: [
      { code: "99395", description: "Preventive visit, established, 18-39" },
      { code: "99396", description: "Preventive visit, established, 40-64" },
      { code: "99397", description: "Preventive visit, established, 65+" },
    ],
    tags: ["annual", "wellness", "preventive", "physical", "screening"],
  },
  {
    id: "acute-sick-visit",
    name: "Acute Sick Visit",
    specialty: "primary_care",
    format: "soap",
    category: "general",
    description: "Acute illness or symptom evaluation with focused history and examination.",
    sections: {
      subjective: "Patient presents with {{chief_complaint}} for {{duration}}. Onset: {{onset}}. Severity: {{severity}}/10. Associated symptoms: {{associated_symptoms}}. Aggravating factors: {{aggravating}}. Alleviating factors: {{alleviating}}. Prior treatment attempted: {{prior_treatment}}.",
      objective: "Vitals: BP {{bp}}, HR {{hr}}, Temp {{temp}}, SpO2 {{spo2}}. General: {{general_appearance}}. Focused exam: {{focused_exam_findings}}.",
      assessment: "{{diagnosis}}. Differential includes: {{differential_diagnoses}}.",
      plan: "1. {{treatment_plan}}\n2. Medications: {{prescriptions}}\n3. Patient education: {{education}}\n4. Return precautions: {{return_precautions}}\n5. Follow-up: {{follow_up}}",
    },
    defaultCodes: [
      { code: "99213", description: "Office visit, established, low complexity" },
      { code: "99214", description: "Office visit, established, moderate complexity" },
    ],
    tags: ["acute", "sick", "illness", "urgent", "symptom"],
  },
  {
    id: "follow-up-visit",
    name: "Follow-up Visit",
    specialty: "primary_care",
    format: "soap",
    category: "general",
    description: "Follow-up visit for chronic condition management or post-procedure check.",
    sections: {
      subjective: "Patient returns for follow-up of {{condition}}. Since last visit: {{interval_history}}. Current symptoms: {{current_symptoms}}. Medication compliance: {{medication_adherence}}. Side effects: {{side_effects}}.",
      objective: "Vitals: BP {{bp}}, HR {{hr}}, Weight {{weight}}. {{focused_exam}}. Labs/imaging reviewed: {{results_review}}.",
      assessment: "{{condition}} — {{status}} (improved/stable/worsening). {{additional_assessments}}.",
      plan: "1. {{medication_changes}}\n2. {{lifestyle_modifications}}\n3. {{orders}}\n4. Follow-up: {{follow_up_interval}}",
    },
    defaultCodes: [
      { code: "99214", description: "Office visit, established, moderate complexity" },
    ],
    tags: ["follow-up", "chronic", "management", "review"],
  },
  {
    id: "telehealth-consultation",
    name: "Telehealth Consultation",
    specialty: "primary_care",
    format: "soap",
    category: "general",
    description: "Virtual visit via video or audio telehealth platform.",
    sections: {
      subjective: "Telehealth visit conducted via {{platform}} (video/audio). Patient reports: {{chief_complaint}}. {{history_of_present_illness}}. Current medications: {{medications}}.",
      objective: "Visual assessment via video: {{visual_findings}}. Patient-reported vitals: BP {{bp}}, Temp {{temp}}, HR {{hr}}. Limitations of virtual exam noted: {{exam_limitations}}.",
      assessment: "{{diagnosis}}. {{clinical_reasoning}}.",
      plan: "1. {{treatment_plan}}\n2. {{prescriptions}}\n3. In-person visit {{needed_or_not}} for: {{in_person_reason}}\n4. Follow-up: {{follow_up}}",
    },
    defaultCodes: [
      { code: "99441", description: "Telephone E/M, 5-10 minutes" },
      { code: "99442", description: "Telephone E/M, 11-20 minutes" },
    ],
    tags: ["telehealth", "virtual", "video", "remote", "telemedicine"],
  },
  {
    id: "behavioral-health-intake",
    name: "Behavioral Health Intake",
    specialty: "psychiatry",
    format: "dap",
    category: "behavioral_health",
    description: "Initial behavioral health assessment using DAP format for intake evaluation.",
    sections: {
      data: "Patient is a {{age}}-year-old {{gender}} presenting for initial behavioral health evaluation. Chief concern: {{chief_complaint}}. Onset: {{onset}}. Psychiatric history: {{psych_history}}. Previous treatment: {{previous_treatment}}. Substance use: {{substance_use}}. Trauma history: {{trauma_history}}. Family psychiatric history: {{family_psych_hx}}. Current stressors: {{current_stressors}}. Support system: {{support_system}}. Mental status exam: Appearance: {{appearance}}. Behavior: {{behavior}}. Mood: {{mood}}. Affect: {{affect}}. Thought process: {{thought_process}}. Thought content: {{thought_content}}. Cognition: {{cognition}}. Insight/Judgment: {{insight_judgment}}. Safety: {{safety_assessment}}.",
      assessment: "{{diagnostic_impression}}. PHQ-9: {{phq9_score}}. GAD-7: {{gad7_score}}. Severity: {{severity}}. Risk level: {{risk_level}}.",
      plan: "1. {{treatment_modality}} (frequency: {{frequency}})\n2. Medications: {{medications}}\n3. Safety plan: {{safety_plan}}\n4. Referrals: {{referrals}}\n5. Goals: {{treatment_goals}}\n6. Next appointment: {{follow_up}}",
    },
    defaultCodes: [
      { code: "90791", description: "Psychiatric diagnostic evaluation" },
      { code: "90837", description: "Psychotherapy, 60 minutes" },
    ],
    tags: ["behavioral", "mental-health", "intake", "psychiatric", "assessment", "dap"],
  },

  // ==================== DENTAL ====================
  {
    id: "comprehensive-oral-exam",
    name: "Comprehensive Oral Exam",
    specialty: "general_dentistry",
    format: "soap",
    category: "dental",
    description: "Comprehensive oral evaluation with full charting, radiographic review, and treatment planning.",
    sections: {
      subjective: "Patient presents for comprehensive oral evaluation. Chief complaint: {{chief_complaint}}. Dental history: {{dental_history}}. Last dental visit: {{last_visit}}. Current oral hygiene routine: {{hygiene_routine}}. Medical history reviewed and updated. Medications: {{medications}}. Allergies: {{allergies}}.",
      objective: "Extraoral exam: TMJ {{tmj_findings}}, lymph nodes {{lymph_nodes}}, facial symmetry {{facial_symmetry}}. Intraoral exam: Soft tissues {{soft_tissue}}, tongue {{tongue}}, floor of mouth {{floor_of_mouth}}, palate {{palate}}. Hard tissue: Tooth #{{tooth_numbers}} — {{findings_per_tooth}}. Existing restorations: {{existing_restorations}}. Occlusion: {{occlusion}}. Periodontal screening: {{psr_scores}}. Radiographic findings: {{xray_findings}}.",
      assessment: "{{dental_diagnoses}}. Caries risk: {{caries_risk}}. Periodontal status: {{perio_status}}.",
      plan: "Phase 1 (Urgent): {{urgent_treatment}}\nPhase 2 (Restorative): {{restorative_plan}}\nPhase 3 (Maintenance): {{maintenance_plan}}\nRecommended frequency: {{recall_interval}}",
    },
    defaultCodes: [
      { code: "D0150", description: "Comprehensive oral evaluation" },
      { code: "D0210", description: "Full mouth radiographic survey" },
      { code: "D0330", description: "Panoramic radiographic image" },
    ],
    tags: ["dental", "comprehensive", "oral-exam", "new-patient", "charting"],
  },
  {
    id: "periodic-dental-exam",
    name: "Periodic Dental Exam",
    specialty: "general_dentistry",
    format: "soap",
    category: "dental",
    description: "Periodic recall exam with prophylaxis and radiographic update.",
    sections: {
      subjective: "Patient presents for periodic recall exam. Any concerns since last visit: {{concerns}}. Changes to medical history: {{medical_changes}}. Current oral hygiene: {{hygiene_assessment}}.",
      objective: "Oral cancer screening: {{ocs_findings}}. Soft tissue: WNL / {{abnormal_findings}}. Hard tissue: {{new_findings}}. Existing restorations: {{restoration_status}}. Periodontal: Probing depths {{probing_summary}}, BOP {{bop_percentage}}%. Radiographs taken: {{radiographs}}. Prophylaxis performed: {{prophy_type}}.",
      assessment: "Oral health status: {{overall_status}}. New findings: {{new_diagnoses}}.",
      plan: "1. {{treatment_recommended}}\n2. Home care instructions: {{home_care}}\n3. Next recall: {{recall_interval}}",
    },
    defaultCodes: [
      { code: "D0120", description: "Periodic oral evaluation" },
      { code: "D0274", description: "Bitewing radiographs, four images" },
      { code: "D1110", description: "Prophylaxis, adult" },
    ],
    tags: ["dental", "periodic", "recall", "cleaning", "hygiene"],
  },
  {
    id: "restorative-procedure",
    name: "Restorative Procedure Note",
    specialty: "general_dentistry",
    format: "procedure_note",
    category: "dental",
    description: "Procedure note for restorative work (fillings, crowns, bridges).",
    sections: {
      indication: "Tooth #{{tooth_number}}: {{indication}} (caries/fracture/defective restoration). Pre-op diagnosis: {{pre_op_diagnosis}}. Radiographic confirmation: {{radiograph_findings}}.",
      procedure: "Anesthesia: {{anesthesia_type}} ({{anesthesia_amount}}). Isolation: {{isolation_method}}. Preparation: {{preparation_description}}. Caries removal: {{caries_extent}} (superficial/moderate/deep). Pulp status: {{pulp_status}}. Liner/base: {{liner_base}}. Restoration: {{restoration_type}} ({{material}}), surfaces: {{surfaces}}. Occlusion adjusted: {{occlusion_check}}. Patient tolerated procedure well.",
      findings: "Cavity classification: {{cavity_class}}. Depth: {{depth}}. Margins: {{margin_quality}}. Contact: {{contact_quality}}.",
      complications: "{{complications_or_none}}",
    },
    defaultCodes: [
      { code: "D2391", description: "Resin composite, 1 surface, posterior" },
      { code: "D2392", description: "Resin composite, 2 surfaces, posterior" },
      { code: "D2740", description: "Crown, porcelain/ceramic" },
    ],
    tags: ["dental", "restorative", "filling", "crown", "procedure"],
  },
  {
    id: "emergency-dental",
    name: "Emergency Dental Visit",
    specialty: "general_dentistry",
    format: "soap",
    category: "dental",
    description: "Emergency or urgent dental evaluation for pain, trauma, or acute infection.",
    sections: {
      subjective: "Patient presents with {{chief_complaint}} involving tooth #{{tooth_number}} / {{region}}. Duration: {{duration}}. Pain level: {{pain_level}}/10. Character: {{pain_character}} (sharp/dull/throbbing). Aggravated by: {{aggravating_factors}}. Associated symptoms: {{associated_symptoms}} (swelling, fever, difficulty opening). History of trauma: {{trauma_history}}.",
      objective: "Extraoral: {{extraoral_findings}} (swelling, asymmetry, lymphadenopathy). Intraoral: Tooth #{{tooth_number}} — {{tooth_findings}}. Percussion: {{percussion}}. Palpation: {{palpation}}. Thermal/EPT: {{vitality_test}}. Mobility: {{mobility}}. Probing: {{probing_depths}}. Radiograph: {{radiographic_findings}}.",
      assessment: "{{emergency_diagnosis}}. Prognosis: {{prognosis}}.",
      plan: "1. Immediate treatment: {{immediate_treatment}}\n2. Medications: {{prescriptions}}\n3. Post-op instructions: {{post_op_instructions}}\n4. Definitive treatment needed: {{definitive_plan}}\n5. Follow-up: {{follow_up}}",
    },
    defaultCodes: [
      { code: "D0140", description: "Limited oral evaluation, problem focused" },
      { code: "D0220", description: "Periapical radiograph, first image" },
      { code: "D9110", description: "Palliative treatment of dental pain" },
    ],
    tags: ["dental", "emergency", "pain", "urgent", "trauma"],
  },
  {
    id: "periodontal-evaluation",
    name: "Periodontal Evaluation",
    specialty: "periodontics",
    format: "soap",
    category: "dental",
    description: "Comprehensive periodontal assessment with full probing, risk assessment, and treatment planning.",
    sections: {
      subjective: "Patient referred for / presents with periodontal concerns. Chief complaint: {{chief_complaint}}. History of periodontal treatment: {{perio_history}}. Risk factors: {{risk_factors}} (smoking, diabetes, family history). Current home care: {{home_care_routine}}.",
      objective: "Full periodontal charting:\n- Probing depths: {{probing_summary}}\n- Clinical attachment loss: {{cal_summary}}\n- Bleeding on probing: {{bop_percentage}}%\n- Suppuration: {{suppuration_sites}}\n- Furcation involvement: {{furcation_findings}}\n- Mobility: {{mobility_findings}}\n- Mucogingival defects: {{mucogingival}}\n- Radiographic bone loss: {{bone_loss_pattern}} (horizontal/vertical)\n- Plaque index: {{plaque_index}}",
      assessment: "Periodontal diagnosis: {{perio_classification}} (Stage {{stage}}, Grade {{grade}}). AAP/EFP classification. Teeth with guarded prognosis: {{guarded_teeth}}.",
      plan: "Phase 1: {{phase1_treatment}} (SRP, antimicrobials)\nPhase 2: {{phase2_surgical}} (if indicated)\nMaintenance interval: {{maintenance_interval}}\nHome care modifications: {{home_care_changes}}",
    },
    defaultCodes: [
      { code: "D0180", description: "Comprehensive periodontal evaluation" },
      { code: "D4341", description: "Periodontal scaling and root planing, per quadrant" },
      { code: "D4910", description: "Periodontal maintenance" },
    ],
    tags: ["dental", "periodontal", "perio", "gum-disease", "probing"],
  },

  // ==================== SPECIALTY ====================
  {
    id: "orthopedic-followup",
    name: "Orthopedic Follow-up",
    specialty: "orthopedics",
    format: "soap",
    category: "general",
    description: "Orthopedic follow-up for musculoskeletal injury, post-surgical, or chronic condition.",
    sections: {
      subjective: "Patient returns for follow-up of {{condition}} affecting {{body_part}}. Current pain: {{pain_level}}/10 (was {{prior_pain_level}}/10). Functional status: {{functional_status}}. Physical therapy progress: {{pt_progress}}. Medications: {{current_meds}}.",
      objective: "Inspection: {{inspection_findings}}. ROM: {{range_of_motion}}. Strength: {{strength_testing}}. Special tests: {{special_tests}}. Neurovascular: {{neurovascular_status}}. Imaging review: {{imaging_findings}}.",
      assessment: "{{diagnosis}} — {{status}} (improving/plateau/worsening). Healing progress: {{healing_assessment}}.",
      plan: "1. {{activity_modifications}}\n2. Physical therapy: {{pt_plan}}\n3. Medications: {{medication_changes}}\n4. Imaging: {{follow_up_imaging}}\n5. Return: {{follow_up_interval}}",
    },
    defaultCodes: [
      { code: "99214", description: "Office visit, established, moderate complexity" },
    ],
    tags: ["orthopedic", "musculoskeletal", "follow-up", "injury", "post-op"],
  },
  {
    id: "dermatology-skin-check",
    name: "Dermatology Skin Check",
    specialty: "dermatology",
    format: "soap",
    category: "preventive",
    description: "Full body skin examination for lesion screening and dermatologic assessment.",
    sections: {
      subjective: "Patient presents for {{full_body_or_focused}} skin examination. Concerns: {{concerns}}. History of skin cancer: {{skin_cancer_history}}. Sun exposure history: {{sun_exposure}}. Family history: {{family_history_skin}}. Changes in moles: {{mole_changes}}.",
      objective: "Full body skin exam performed. Lesions noted:\n{{lesion_list}}\nDermoscopic findings: {{dermoscopy}}. Scalp: {{scalp}}. Nails: {{nails}}. Mucous membranes: {{mucous_membranes}}.",
      assessment: "{{diagnoses}}. Lesions of concern: {{concerning_lesions}}.",
      plan: "1. Biopsies: {{biopsy_plan}}\n2. Treatment: {{treatment}}\n3. Patient education: {{sun_protection_counseling}}\n4. Photography: {{photo_documentation}}\n5. Follow-up: {{follow_up_interval}}",
    },
    defaultCodes: [
      { code: "99213", description: "Office visit, established, low complexity" },
    ],
    tags: ["dermatology", "skin", "screening", "moles", "lesion"],
  },
  {
    id: "psychiatry-med-management",
    name: "Psychiatry Med Management",
    specialty: "psychiatry",
    format: "dap",
    category: "behavioral_health",
    description: "Medication management visit for psychiatric conditions using DAP format.",
    sections: {
      data: "Patient presents for medication management follow-up. Current medications: {{current_meds}}. Compliance: {{adherence}}. Side effects: {{side_effects}}. Symptom update: {{symptom_update}}. Sleep: {{sleep_quality}}. Appetite: {{appetite}}. Energy: {{energy_level}}. Mood: {{self_reported_mood}}. PHQ-9: {{phq9}} (previous: {{prior_phq9}}). GAD-7: {{gad7}} (previous: {{prior_gad7}}). Mental status: {{mse_findings}}. Safety: {{safety_screen}}.",
      assessment: "{{diagnoses}}. Current regimen is {{effective_or_not}}. {{clinical_reasoning}}.",
      plan: "1. Medication changes: {{medication_changes}}\n2. Lab monitoring: {{labs}}\n3. Therapy: {{therapy_status}}\n4. Safety plan: {{safety_plan_status}}\n5. Next visit: {{follow_up}}",
    },
    defaultCodes: [
      { code: "99214", description: "Office visit, established, moderate complexity" },
      { code: "90833", description: "Psychotherapy add-on, 30 minutes" },
    ],
    tags: ["psychiatry", "medication", "management", "mental-health", "dap"],
  },
  {
    id: "pediatric-well-child",
    name: "Pediatric Well-Child Visit",
    specialty: "pediatrics",
    format: "soap",
    category: "preventive",
    description: "Well-child visit with developmental screening, growth assessment, and anticipatory guidance.",
    sections: {
      subjective: "{{age}} {{gender}} presents for well-child visit. Parent concerns: {{parent_concerns}}. Feeding/nutrition: {{nutrition}}. Sleep: {{sleep_pattern}}. Development: {{developmental_milestones}}. Behavior: {{behavior_concerns}}. School performance: {{school_if_applicable}}. Immunization status: {{immunization_review}}.",
      objective: "Vitals: Weight {{weight}} ({{weight_percentile}}%), Height {{height}} ({{height_percentile}}%), HC {{head_circ}} ({{hc_percentile}}%), BMI {{bmi}} ({{bmi_percentile}}%). Growth curve: {{growth_trend}}. General: Well-appearing, {{general_appearance}}. HEENT: {{heent}}. Heart: {{heart}}. Lungs: {{lungs}}. Abdomen: {{abdomen}}. GU: {{gu_exam}}. MSK: {{msk}}. Neuro/Dev: {{neuro_dev}}. Skin: {{skin}}. Developmental screening: {{screening_tool}} — {{screening_result}}.",
      assessment: "Healthy {{age}} with {{assessments}}. Growth: {{growth_assessment}}. Development: {{developmental_assessment}}.",
      plan: "1. Immunizations administered: {{vaccines_given}}\n2. Screening: {{screenings}}\n3. Anticipatory guidance: {{anticipatory_guidance}}\n4. Referrals: {{referrals}}\n5. Next well-child: {{next_visit}}",
    },
    defaultCodes: [
      { code: "99392", description: "Preventive visit, established, 1-4 years" },
      { code: "99393", description: "Preventive visit, established, 5-11 years" },
      { code: "99394", description: "Preventive visit, established, 12-17 years" },
    ],
    tags: ["pediatric", "well-child", "developmental", "growth", "preventive"],
  },
  {
    id: "cardiology-consultation",
    name: "Cardiology Consultation",
    specialty: "cardiology",
    format: "hpi_focused",
    category: "general",
    description: "Cardiology consultation with detailed HPI, cardiac-focused review of systems, and risk stratification.",
    sections: {
      hpiNarrative: "{{referring_provider}} requests cardiology consultation for {{reason_for_referral}}. Patient is a {{age}}-year-old {{gender}} with PMH significant for {{past_medical_history}}. The patient reports {{presenting_symptoms}} with onset {{onset}}, duration {{duration}}, frequency {{frequency}}. Associated symptoms include {{associated_symptoms}}. Cardiac risk factors: {{risk_factors}} (HTN, DM, hyperlipidemia, smoking, family history of premature CAD). Exercise tolerance: {{exercise_tolerance}}. NYHA class: {{nyha_class}}. Prior cardiac workup: {{prior_workup}}. Current cardiac medications: {{cardiac_meds}}.",
      reviewOfSystems: "Cardiovascular: {{cv_ros}}. Respiratory: {{resp_ros}}. Constitutional: {{constitutional_ros}}.",
      objective: "Vitals: BP {{bp}} (bilateral: R {{bp_right}}, L {{bp_left}}), HR {{hr}}, SpO2 {{spo2}}. Cardiovascular: {{heart_exam}} (rate, rhythm, murmurs, gallops, JVP, carotid bruits). Pulmonary: {{lung_exam}}. Extremities: {{peripheral_exam}} (edema, pulses). ECG: {{ecg_findings}}. Prior imaging: {{imaging_review}}.",
      assessment: "{{cardiac_diagnoses}}. Risk stratification: {{risk_level}}. {{clinical_reasoning}}.",
      plan: "1. Diagnostic workup: {{diagnostic_orders}} (echo, stress test, Holter, cath)\n2. Medications: {{medication_recommendations}}\n3. Lifestyle: {{lifestyle_modifications}}\n4. Risk factor management: {{risk_factor_plan}}\n5. Follow-up: {{follow_up}}\n6. Communication to referring provider: {{communication_plan}}",
    },
    defaultCodes: [
      { code: "99244", description: "Office consultation, moderate complexity" },
      { code: "99245", description: "Office consultation, high complexity" },
      { code: "93000", description: "Electrocardiogram, 12-lead" },
    ],
    tags: ["cardiology", "consultation", "cardiac", "heart", "hpi-focused"],
  },
];

// ─── Helper Functions ─────────────────────────────────────────────────

export function getTemplatesBySpecialty(specialty: string): ClinicalNoteTemplate[] {
  const s = specialty.toLowerCase().trim();
  return CLINICAL_NOTE_TEMPLATES.filter(t => t.specialty.toLowerCase() === s);
}

export function getTemplatesByFormat(format: string): ClinicalNoteTemplate[] {
  const f = format.toLowerCase().trim();
  return CLINICAL_NOTE_TEMPLATES.filter(t => t.format.toLowerCase() === f);
}

export function getTemplatesByCategory(category: string): ClinicalNoteTemplate[] {
  const c = category.toLowerCase().trim();
  return CLINICAL_NOTE_TEMPLATES.filter(t => t.category.toLowerCase() === c);
}

export function getTemplateById(id: string): ClinicalNoteTemplate | undefined {
  return CLINICAL_NOTE_TEMPLATES.find(t => t.id === id);
}

export function searchTemplates(query: string): ClinicalNoteTemplate[] {
  const terms = query.toLowerCase().trim().split(/\s+/);
  return CLINICAL_NOTE_TEMPLATES.filter(t => {
    const searchable = [
      t.name, t.description, t.specialty, t.format, t.category,
      ...t.tags,
    ].join(" ").toLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}
