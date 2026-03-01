import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Templates() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Dynamic Templates"
        description="Use Handlebars templates with Faker.js to generate realistic mock data."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="text-slate-400 mb-4">
          Mocklify uses Handlebars templating with 80+ Faker.js helpers to generate dynamic, realistic data for your mock responses.
        </p>
        <CodeBlock
          title="Example Template"
          language="json"
          code={`{
  "id": "{{faker 'string.uuid'}}",
  "name": "{{faker 'person.fullName'}}",
  "email": "{{faker 'internet.email'}}",
  "avatar": "{{faker 'image.avatar'}}",
  "createdAt": "{{now}}"
}`}
        />
      </section>

      {/* Faker.js Helpers */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Faker.js Helpers</h2>
        <p className="text-slate-400 mb-4">
          Access any Faker.js method using the <code className="px-2 py-0.5 bg-slate-800 rounded">faker</code> helper:
        </p>
        
        <div className="bg-[#1a2332] rounded-xl border border-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-4 py-3 text-slate-300 whitespace-nowrap">Category</th>
                <th className="text-left px-4 py-3 text-slate-300">Examples</th>
              </tr>
            </thead>
            <tbody className="text-slate-400">
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-medium text-white">Person</td>
                <td className="px-4 py-3 font-mono text-sm">person.firstName, person.lastName, person.fullName, person.jobTitle</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-medium text-white">Internet</td>
                <td className="px-4 py-3 font-mono text-sm">internet.email, internet.url, internet.userName, internet.password</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-medium text-white">Location</td>
                <td className="px-4 py-3 font-mono text-sm">location.city, location.country, location.streetAddress, location.zipCode</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-medium text-white">Commerce</td>
                <td className="px-4 py-3 font-mono text-sm">commerce.productName, commerce.price, commerce.department</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-medium text-white">Lorem</td>
                <td className="px-4 py-3 font-mono text-sm">lorem.sentence, lorem.paragraph, lorem.words</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-white">String</td>
                <td className="px-4 py-3 font-mono text-sm">string.uuid, string.alphanumeric, string.nanoid</td>
              </tr>
            </tbody>
          </table>
        </div>

        <InfoBox type="tip" title="Full List">
          See the <a href="https://fakerjs.dev/api/" target="_blank" rel="noopener" className="text-purple-400 hover:underline">Faker.js documentation</a> for all available methods.
        </InfoBox>
      </section>

      {/* Built-in Helpers */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Built-in Helpers</h2>
        
        <div className="bg-[#1a2332] rounded-xl border border-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-4 py-3 text-slate-300 whitespace-nowrap">Helper</th>
                <th className="text-left px-4 py-3 text-slate-300 whitespace-nowrap">Description</th>
                <th className="text-left px-4 py-3 text-slate-300 whitespace-nowrap">Example Output</th>
              </tr>
            </thead>
            <tbody className="text-slate-400">
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">{"{{now}}"}</td>
                <td className="px-4 py-3">Current ISO timestamp</td>
                <td className="px-4 py-3 font-mono text-sm">2024-01-15T10:30:00.000Z</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">{"{{timestamp}}"}</td>
                <td className="px-4 py-3">Unix timestamp (ms)</td>
                <td className="px-4 py-3 font-mono text-sm">1705315800000</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">{"{{uuid}}"}</td>
                <td className="px-4 py-3">Random UUID v4</td>
                <td className="px-4 py-3 font-mono text-sm">a1b2c3d4-e5f6-...</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">{"{{randomInt min max}}"}</td>
                <td className="px-4 py-3">Random integer</td>
                <td className="px-4 py-3 font-mono text-sm">42</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">{"{{randomFloat min max}}"}</td>
                <td className="px-4 py-3">Random float</td>
                <td className="px-4 py-3 font-mono text-sm">3.14</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Request Data Access */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Accessing Request Data</h2>
        <p className="text-slate-400 mb-4">
          Use the <code className="px-2 py-0.5 bg-slate-800 rounded">request</code> object to access incoming request data:
        </p>

        <CodeBlock
          title="Request Data in Templates"
          language="json"
          code={`{
  "userId": "{{request.params.id}}",
  "search": "{{request.query.q}}",
  "page": "{{request.query.page}}",
  "userName": "{{request.body.name}}",
  "authHeader": "{{request.headers.authorization}}",
  "method": "{{request.method}}",
  "path": "{{request.path}}"
}`}
        />
      </section>

      {/* Repeat Helper */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Generating Arrays</h2>
        <p className="text-slate-400 mb-4">
          Use the <code className="px-2 py-0.5 bg-slate-800 rounded">repeat</code> helper to generate arrays of data:
        </p>

        <CodeBlock
          language="json"
          code={`{
  "users": [
    {{#repeat 5}}
    {
      "id": "{{faker 'string.uuid'}}",
      "name": "{{faker 'person.fullName'}}",
      "email": "{{faker 'internet.email'}}"
    }{{#unless @last}},{{/unless}}
    {{/repeat}}
  ]
}`}
        />
      </section>

      {/* Conditional Logic */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Conditional Logic</h2>
        <p className="text-slate-400 mb-4">
          Use Handlebars conditionals for dynamic responses:
        </p>

        <CodeBlock
          language="json"
          code={`{
  "status": "{{#if request.query.active}}active{{else}}inactive{{/if}}",
  "premium": {{#eq request.headers.x-tier "premium"}}true{{else}}false{{/eq}}
}`}
        />

        <InfoBox type="info">
          Available conditionals: <code>if</code>, <code>unless</code>, <code>eq</code>, <code>ne</code>, <code>gt</code>, <code>lt</code>
        </InfoBox>
      </section>

      {/* JSON Stringify */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Echo Request Body</h2>
        <p className="text-slate-400 mb-4">
          Echo back the request body in your response:
        </p>

        <CodeBlock
          language="json"
          code={`{
  "received": {{{json request.body}}},
  "timestamp": "{{now}}"
}`}
        />
      </section>
    </div>
  );
}
