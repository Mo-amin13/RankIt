function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "?";
  }

  const letters =
    words.length === 1 ? [[...words[0]][0]] : [[...words[0]][0], [...words[1]][0]];

  return letters.join("").toUpperCase();
}

export default function Monogram({ name }: { name: string }) {
  return (
    <span className="monogram" aria-hidden="true">
      {initials(name)}
    </span>
  );
}
