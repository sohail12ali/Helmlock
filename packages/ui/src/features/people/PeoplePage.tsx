// People (Blueprint 31, F93): who the console thinks you are (author.local, never guessed), the roster from
// people.toml with every git spelling each person claims, git names nobody claims yet, and a form to add a person.
// Writes: people claim <id> <name-or-email>, people add.
import type { PeopleView } from "@helmlock/core/contracts";
import { UserCheck, UserX } from "lucide-react";
import { useId, useState } from "react";
import { INVALIDATE_M6, initialsOf, slugify, usePeople } from "@/api/m6";
import { CopyCommand, EmptyState, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { Field, Select } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Person = PeopleView["people"][number];
type Unknown = PeopleView["unknown_git"][number];

function MeCard({ me }: { me: PeopleView["me"] }) {
  if (!me)
    return (
      <Card aria-labelledby="people-me" className="border-warn/50">
        <CardHeader>
          <CardTitle id="people-me" className="flex items-center gap-2">
            <UserX className="size-4 text-warn" /> You are not set on this machine
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            Helmlock reads who you are from <Mono>author.local</Mono> in the workspace root (this machine only, never committed) and never guesses it. Put your
            person id from the roster below in that file, or add yourself first.
          </p>
          <CopyCommand className="max-w-md" label="Then check" command="hl where" />
        </CardContent>
      </Card>
    );
  return (
    <Card aria-labelledby="people-me">
      <CardHeader>
        <CardTitle id="people-me" className="flex items-center gap-2">
          <UserCheck className="size-4 text-ok" /> You are {me.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink2">
        <span>
          id <Mono>{me.id}</Mono>
        </span>
        <span>
          initials <Mono>{me.initials}</Mono>
        </span>
        {me.email && <span>{me.email}</span>}
        <span className="w-full text-xs text-muted-foreground">
          From <Mono>author.local</Mono> on this machine. Your personal items live in <Mono>people/{me.id}/</Mono> (committed, visible to the team).
        </span>
      </CardContent>
    </Card>
  );
}

function Roster({ people, me }: { people: Person[]; me?: string }) {
  if (people.length === 0) return <EmptyState title="Nobody in people.toml yet." hint="Add the first person below." command='hl people add <id> "<name>"' />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label="Roster">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Name</th>
            <th className="py-1.5 pr-3 font-medium">Initials</th>
            <th className="py-1.5 pr-3 font-medium">Role</th>
            <th className="py-1.5 font-medium">Git names</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {people.map((p) => (
            <tr key={p.id} data-person={p.id}>
              <td className="py-1.5 pr-3">
                <span className="font-medium">{p.name}</span> <Mono className="text-xs text-muted-foreground">{p.id}</Mono>
                {p.id === me && (
                  <Badge variant="accent" className="ml-1.5">
                    you
                  </Badge>
                )}
              </td>
              <td className="py-1.5 pr-3">
                <Mono>{p.initials}</Mono>
              </td>
              <td className="py-1.5 pr-3 text-ink2">{p.role ?? "-"}</td>
              <td className="py-1.5">
                <span className="flex flex-wrap gap-1">
                  {p.git.length === 0 ? (
                    <span className="text-xs text-muted-foreground">none claimed</span>
                  ) : (
                    p.git.map((g) => (
                      <Badge key={g} variant="outline" className="font-mono">
                        {g}
                      </Badge>
                    ))
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClaimRow({ u, people }: { u: Unknown; people: Person[] }) {
  const [who, setWho] = useState("");
  const [spelling, setSpelling] = useState<"name" | "email">(u.email ? "email" : "name");
  const v = useVerbRun("people claim", INVALIDATE_M6.people);
  const value = spelling === "email" && u.email ? u.email : u.name;
  return (
    <li className="flex flex-col gap-1.5 py-2" data-git={u.email || u.name}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{u.name}</span> {u.email && <Mono className="text-xs text-muted-foreground">&lt;{u.email}&gt;</Mono>}{" "}
          <span className="text-xs text-muted-foreground">
            {u.commits} commit{u.commits === 1 ? "" : "s"}
          </span>
        </span>
        {u.email && (
          <Select
            aria-label={`Claim by: ${u.name}`}
            className="h-7 w-auto text-xs"
            value={spelling}
            onChange={(e) => setSpelling(e.target.value as "name" | "email")}
          >
            <option value="email">by email</option>
            <option value="name">by name</option>
          </Select>
        )}
        <span className="text-xs text-ink2" aria-hidden>
          This is
        </span>
        <Select aria-label={`This is…: ${u.name}`} className="h-7 w-auto text-xs" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">pick a person</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={!who || v.pending} onClick={() => void v.run({ id: who, git: value })}>
          Claim
        </Button>
      </div>
      {v.last && <VerbResult result={v.last.result} okText={`Claimed ${value}.`} />}
    </li>
  );
}

function Unclaimed({ list, people }: { list: Unknown[]; people: Person[] }) {
  if (list.length === 0) return <p className="text-sm text-muted-foreground">Every git author in this repo belongs to someone in the roster.</p>;
  return (
    <ul className="divide-y text-sm" aria-label="Unclaimed git names">
      {list.map((u) => (
        <ClaimRow key={`${u.name}<${u.email}>`} u={u} people={people} />
      ))}
    </ul>
  );
}

function AddPerson() {
  const uid = useId();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [initials, setInitials] = useState("");
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const v = useVerbRun("people add", INVALIDATE_M6.people);
  const effId = idTouched ? id : slugify(name);
  const effInitials = initialsTouched ? initials : initialsOf(name);
  const reset = () => {
    setName("");
    setId("");
    setIdTouched(false);
    setInitials("");
    setInitialsTouched(false);
    setRole("");
    setEmail("");
  };
  return (
    <form
      aria-label="Add person"
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || !effId) return;
        const input: Record<string, unknown> = { id: effId, name: name.trim(), initials: effInitials };
        if (role.trim()) input.role = role.trim();
        if (email.trim()) input.email = email.trim();
        const r = await v.run(input);
        if (r.ok) reset();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_6rem_9rem_1fr_auto] lg:items-end">
        <Field label="Name" htmlFor={`${uid}-name`} required>
          <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Id" htmlFor={`${uid}-id`} required>
          <Input
            id={`${uid}-id`}
            className="font-mono"
            value={effId}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
          />
        </Field>
        <Field label="Initials" htmlFor={`${uid}-initials`} required>
          <Input
            id={`${uid}-initials`}
            className="font-mono"
            value={effInitials}
            onChange={(e) => {
              setInitialsTouched(true);
              setInitials(e.target.value);
            }}
          />
        </Field>
        <Field label="Role" htmlFor={`${uid}-role`}>
          <Input id={`${uid}-role`} value={role} onChange={(e) => setRole(e.target.value)} placeholder="optional" />
        </Field>
        <Field label="Email" htmlFor={`${uid}-email`}>
          <Input id={`${uid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
        </Field>
        <Button type="submit" disabled={!name.trim() || !effId || !effInitials || v.pending}>
          Add person
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Writes people.toml (Team: committed, visible to everyone with the repo).</p>
      {v.last && <VerbResult result={v.last.result} />}
    </form>
  );
}

export function PeoplePage() {
  const q = usePeople();
  return (
    <PageLayout id="people">
      <PageHeader title="People" />
      <div className="grid w-full gap-3">
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : !q.data ? (
          <EmptyState title="This server has no people view yet." hint="Update Helmlock and restart the console." command="hl people list" />
        ) : (
          <>
            <MeCard me={q.data.me} />
            <Card aria-labelledby="people-roster">
              <CardHeader>
                <CardTitle id="people-roster">Roster</CardTitle>
              </CardHeader>
              <CardContent>
                <Roster people={q.data.people} me={q.data.me?.id} />
              </CardContent>
            </Card>
            <Card aria-labelledby="people-unknown">
              <CardHeader>
                <CardTitle id="people-unknown">Unclaimed git names</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Commit authors nobody claims. Claiming one only attributes those commits to a person; it never changes who you are.
                </p>
                <Unclaimed list={q.data.unknown_git} people={q.data.people} />
              </CardContent>
            </Card>
            <Card aria-labelledby="people-add">
              <CardHeader>
                <CardTitle id="people-add">Add person</CardTitle>
              </CardHeader>
              <CardContent>
                <AddPerson />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  );
}
