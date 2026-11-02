import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DocsNotFound() {
  return (
    <div className="flex flex-col items-start gap-4 py-6">
      <h1 className="text-3xl font-semibold">Doc page not found</h1>
      <p className="text-pretty text-muted-foreground">This documentation page does not exist.</p>
      <Button render={<Link href="/docs" />}>Go to documentation</Button>
    </div>
  );
}
