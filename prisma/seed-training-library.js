const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Matches training-scripts/ exactly — verifiedStatus is honest about
// what was actually confirmed this session: classical ML was
// genuinely executed end-to-end with real validation metrics; the
// other three had every non-GPU-dependent piece tested (data loading,
// label encoding, quality checks, the graceful-fallback pattern) but
// never ran an actual training loop, since PyTorch's CUDA-bundled
// dependencies didn't fit in the dev sandbox's disk space.
const LIBRARY_ENTRIES = [
  {
    name: 'Classical ML — Random Forest', scriptPath: 'train_classical_ml.py', modelType: 'CLASSICAL_ML',
    description: 'Trains a Random Forest regressor mapping process parameters to an outcome (e.g. scrap rate), then grid-searches for the parameter combination predicted to minimize it. This is the Golden Batch recommendation mechanism.',
    requiredPackages: ['numpy', 'pandas', 'scikit-learn'],
    verifiedStatus: 'TESTED', exampleBaseModel: 'Random Forest Regressor',
  },
  {
    name: 'Time-Series — LSTM (RUL Prediction)', scriptPath: 'train_time_series.py', modelType: 'TIME_SERIES',
    description: 'Trains an LSTM to predict Remaining Useful Life from windowed sensor features (rolling mean/std/trend). The Predictive Maintenance pillar\'s core model type.',
    requiredPackages: ['torch', 'numpy', 'pandas'],
    verifiedStatus: 'REFERENCE_ONLY', exampleBaseModel: 'LSTM (2-layer, 64 hidden units)',
  },
  {
    name: 'Vision — ResNet-50 Transfer Learning', scriptPath: 'train_vision.py', modelType: 'VISION',
    description: 'Fine-tunes a pretrained ResNet-50 for defect classification via transfer learning (frozen backbone, trained classifier head). Requires a real image manifest — see GET /api/v1/lab/vision-jobs/:jobId/manifest.',
    requiredPackages: ['torch', 'torchvision', 'pillow'],
    verifiedStatus: 'REFERENCE_ONLY', exampleBaseModel: 'ResNet-50 (ImageNet1K_V2 weights)',
  },
  {
    name: 'LLM — LoRA Fine-Tuning', scriptPath: 'train_transformer.py', modelType: 'LLM',
    description: 'LoRA fine-tuning via HuggingFace transformers + PEFT on an instruction dataset. Produces a lightweight adapter checkpoint, not a full model copy.',
    requiredPackages: ['torch', 'transformers', 'peft', 'datasets'],
    verifiedStatus: 'REFERENCE_ONLY', exampleBaseModel: 'Qwen 2.5 7B Instruct',
  },
];

async function seedTrainingLibrary(prismaClient) {
  const db = prismaClient || prisma;
  const existing = await db.trainingScriptLibrary.count();
  if (existing > 0) {
    console.log(`✓ Training script library already seeded (${existing} entries) — skipping`);
    return;
  }
  let created = 0;
  for (const entry of LIBRARY_ENTRIES) {
    try {
      await db.trainingScriptLibrary.create({ data: entry });
      created++;
    } catch (e) {
      console.error(`⚠ Library entry seed failed for ${entry.scriptPath} (non-fatal):`, e.message);
    }
  }
  console.log(`✓ Training script library: ${created} entries seeded`);
}

module.exports = { seedTrainingLibrary, LIBRARY_ENTRIES };

if (require.main === module) {
  seedTrainingLibrary()
    .catch((e) => { console.error('❌ Training library seed failed:', e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
}
