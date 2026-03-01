interface PageHeaderProps {
  title: string;
  description: string;
}

export default function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 gradient-text">{title}</h1>
      <p className="text-base sm:text-lg theme-text-secondary">{description}</p>
    </div>
  );
}
