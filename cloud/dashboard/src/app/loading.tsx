export default function Loading() {
  const statSkeletons = ["fetches", "cost", "quota", "rate", "seats", "activity"];
  const rowSkeletons = ["first", "second", "third", "fourth", "fifth", "sixth"];

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <div className="skel h-7 w-48" />
        <div className="skel h-4 w-[60ch] max-w-full" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {statSkeletons.map((id) => (
          <div key={id} className="surface p-4 flex flex-col gap-3">
            <div className="skel h-3 w-20" />
            <div className="skel h-7 w-24" />
            <div className="skel h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="surface lg:col-span-2 p-4">
          <div className="skel h-[220px] w-full" />
        </div>
        <div className="surface p-4 flex flex-col gap-2">
          {rowSkeletons.map((id) => (
            <div key={id} className="skel h-5 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
