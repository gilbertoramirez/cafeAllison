import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Administración</h1>
        <LoginForm />
      </div>
    </main>
  );
}
