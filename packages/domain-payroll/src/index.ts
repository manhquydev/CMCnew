export {
  PIT_BRACKETS,
  SELF_RELIEF,
  DEPENDENT_RELIEF,
  taxableIncome,
  computePit,
  type TaxBracket,
} from './pit.js';
export {
  prorate,
  kpiGradeFromScore,
  assemblePayslip,
  type KpiGrade,
  type PayBlock,
  type PayslipInput,
  type PayslipResult,
} from './payslip.js';
export {
  cvtvNewCustomerRate,
  managerNewCustomerRate,
  renewalRate,
  commissionAmount,
  overtimeUnitPrice,
  overtimePay,
  parttimePackageGross,
  type ManagerRole,
  type RenewalRole,
} from './commission.js';
export {
  compensationParamsSchema,
  DEFAULT_PARAMS,
  kpiCriterionConfigSchema,
  type CompensationParams,
  type KpiCriterionConfig,
} from './params.js';
export {
  weightedKpi,
  ratioToScore,
  type KpiCriterion,
  type KpiComposite,
} from './kpi.js';
