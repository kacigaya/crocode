import DocPage, { generateMetadata as docMetadata } from "@/app/docs/[[...slug]]/page";
import DocsLayout from "@/app/docs/layout";

export async function generateMetadata() {
  return {
    ...await docMetadata({ params: Promise.resolve({}) }),
    title: { absolute: "CroCode Docs" },
  };
}

export default function DocsHome() {
  return (
    <DocsLayout>
      <DocPage params={Promise.resolve({})} />
    </DocsLayout>
  );
}
