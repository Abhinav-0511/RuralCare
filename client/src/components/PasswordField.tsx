export function PasswordField(props: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-stone-700">{props.label}</span>
      <input
        name={props.name}
        type="password"
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="min-h-12 w-full rounded-lg border border-stone-300 px-3 text-lg"
        required
      />
    </label>
  );
}
