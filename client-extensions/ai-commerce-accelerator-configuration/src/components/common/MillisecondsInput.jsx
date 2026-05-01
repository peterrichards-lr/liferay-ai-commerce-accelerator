import ClayForm, { ClayInput } from '@clayui/form';
import { msToHuman } from '../../utils/helper';

export default function MillisecondsInput({
  id,
  label,
  value,
  min = 1000,
  step = 1000,
  onChange,
  helper,
}) {
  return (
    <ClayForm.Group>
      <label htmlFor={id} className="font-weight-semi-bold">
        {label}
      </label>
      <ClayInput
        id={id}
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={onChange}
      />
      {helper && <small className="form-text text-secondary">{helper}</small>}
      <small className="form-text text-muted">≈ {msToHuman(value)}</small>
    </ClayForm.Group>
  );
}
