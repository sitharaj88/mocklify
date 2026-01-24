import Handlebars from 'handlebars';
import { faker } from '@faker-js/faker';

export class TemplateEngine {
  private handlebars: typeof Handlebars;

  constructor() {
    this.handlebars = Handlebars.create();
    this.registerHelpers();
  }

  /**
   * Render a template with the given context
   */
  async render(template: string, context: Record<string, unknown>): Promise<string> {
    const compiled = this.handlebars.compile(template, {
      noEscape: true, // Don't escape HTML - we're generating JSON/data
    });
    return compiled(context);
  }

  /**
   * Register custom Handlebars helpers
   */
  private registerHelpers(): void {
    // Faker helpers
    this.registerFakerHelpers();

    // Utility helpers
    this.registerUtilityHelpers();
  }

  /**
   * Register Faker.js helpers for generating fake data
   */
  private registerFakerHelpers(): void {
    // Person
    this.handlebars.registerHelper('faker.firstName', () => faker.person.firstName());
    this.handlebars.registerHelper('faker.lastName', () => faker.person.lastName());
    this.handlebars.registerHelper('faker.fullName', () => faker.person.fullName());
    this.handlebars.registerHelper('faker.jobTitle', () => faker.person.jobTitle());
    this.handlebars.registerHelper('faker.gender', () => faker.person.gender());
    this.handlebars.registerHelper('faker.bio', () => faker.person.bio());

    // Internet
    this.handlebars.registerHelper('faker.email', () => faker.internet.email());
    this.handlebars.registerHelper('faker.userName', () => faker.internet.username());
    this.handlebars.registerHelper('faker.url', () => faker.internet.url());
    this.handlebars.registerHelper('faker.avatar', () => faker.image.avatar());
    this.handlebars.registerHelper('faker.ip', () => faker.internet.ip());
    this.handlebars.registerHelper('faker.ipv6', () => faker.internet.ipv6());
    this.handlebars.registerHelper('faker.userAgent', () => faker.internet.userAgent());

    // Location
    this.handlebars.registerHelper('faker.city', () => faker.location.city());
    this.handlebars.registerHelper('faker.country', () => faker.location.country());
    this.handlebars.registerHelper('faker.countryCode', () => faker.location.countryCode());
    this.handlebars.registerHelper('faker.state', () => faker.location.state());
    this.handlebars.registerHelper('faker.zipCode', () => faker.location.zipCode());
    this.handlebars.registerHelper('faker.streetAddress', () => faker.location.streetAddress());
    this.handlebars.registerHelper('faker.latitude', () => faker.location.latitude());
    this.handlebars.registerHelper('faker.longitude', () => faker.location.longitude());

    // Lorem
    this.handlebars.registerHelper('faker.word', () => faker.lorem.word());
    this.handlebars.registerHelper('faker.words', (count: number = 3) =>
      faker.lorem.words(typeof count === 'number' ? count : 3)
    );
    this.handlebars.registerHelper('faker.sentence', () => faker.lorem.sentence());
    this.handlebars.registerHelper('faker.sentences', (count: number = 3) =>
      faker.lorem.sentences(typeof count === 'number' ? count : 3)
    );
    this.handlebars.registerHelper('faker.paragraph', () => faker.lorem.paragraph());
    this.handlebars.registerHelper('faker.paragraphs', (count: number = 3) =>
      faker.lorem.paragraphs(typeof count === 'number' ? count : 3)
    );
    this.handlebars.registerHelper('faker.text', () => faker.lorem.text());

    // Date/Time
    this.handlebars.registerHelper('faker.past', () => faker.date.past().toISOString());
    this.handlebars.registerHelper('faker.future', () => faker.date.future().toISOString());
    this.handlebars.registerHelper('faker.recent', () => faker.date.recent().toISOString());
    this.handlebars.registerHelper('faker.soon', () => faker.date.soon().toISOString());
    this.handlebars.registerHelper('faker.month', () => faker.date.month());
    this.handlebars.registerHelper('faker.weekday', () => faker.date.weekday());

    // Number
    this.handlebars.registerHelper('faker.number', (options?: { min?: number; max?: number }) => {
      if (typeof options === 'object' && options !== null) {
        return faker.number.int({ min: options.min ?? 0, max: options.max ?? 1000 });
      }
      return faker.number.int({ min: 0, max: 1000 });
    });
    this.handlebars.registerHelper('faker.float', (options?: { min?: number; max?: number }) => {
      if (typeof options === 'object' && options !== null) {
        return faker.number.float({ min: options.min ?? 0, max: options.max ?? 1000 });
      }
      return faker.number.float({ min: 0, max: 1000 });
    });

    // Datatype
    this.handlebars.registerHelper('faker.uuid', () => faker.string.uuid());
    this.handlebars.registerHelper('faker.boolean', () => faker.datatype.boolean());
    this.handlebars.registerHelper('faker.hexColor', () => faker.color.rgb());

    // Commerce
    this.handlebars.registerHelper('faker.productName', () => faker.commerce.productName());
    this.handlebars.registerHelper('faker.productDescription', () =>
      faker.commerce.productDescription()
    );
    this.handlebars.registerHelper('faker.price', () => faker.commerce.price());
    this.handlebars.registerHelper('faker.department', () => faker.commerce.department());

    // Company
    this.handlebars.registerHelper('faker.companyName', () => faker.company.name());
    this.handlebars.registerHelper('faker.catchPhrase', () => faker.company.catchPhrase());

    // Phone
    this.handlebars.registerHelper('faker.phoneNumber', () => faker.phone.number());
    this.handlebars.registerHelper('faker.imei', () => faker.phone.imei());

    // Image
    this.handlebars.registerHelper('faker.imageUrl', (options?: { width?: number; height?: number }) => {
      const width = typeof options === 'object' && options?.width ? options.width : 640;
      const height = typeof options === 'object' && options?.height ? options.height : 480;
      return faker.image.url({ width, height });
    });

    // Finance
    this.handlebars.registerHelper('faker.amount', () => faker.finance.amount());
    this.handlebars.registerHelper('faker.currency', () => faker.finance.currency().name);
    this.handlebars.registerHelper('faker.currencyCode', () => faker.finance.currency().code);
    this.handlebars.registerHelper('faker.creditCardNumber', () => faker.finance.creditCardNumber());
    this.handlebars.registerHelper('faker.iban', () => faker.finance.iban());
    this.handlebars.registerHelper('faker.bic', () => faker.finance.bic());

    // System
    this.handlebars.registerHelper('faker.fileName', () => faker.system.fileName());
    this.handlebars.registerHelper('faker.fileExt', () => faker.system.fileExt());
    this.handlebars.registerHelper('faker.mimeType', () => faker.system.mimeType());
  }

  /**
   * Register utility helpers
   */
  private registerUtilityHelpers(): void {
    // JSON stringify
    this.handlebars.registerHelper('json', (context: unknown) => {
      return JSON.stringify(context);
    });

    // Now timestamp
    this.handlebars.registerHelper('now', (format?: string) => {
      const date = new Date();
      if (format === 'iso') {
        return date.toISOString();
      } else if (format === 'unix') {
        return Math.floor(date.getTime() / 1000);
      } else if (format === 'ms') {
        return date.getTime();
      }
      return date.toISOString();
    });

    // Random from array
    this.handlebars.registerHelper('oneOf', (...args: unknown[]) => {
      // Last argument is Handlebars options object
      const items = args.slice(0, -1);
      if (items.length === 0) return '';
      return items[Math.floor(Math.random() * items.length)];
    });

    // Repeat helper for generating arrays
    this.handlebars.registerHelper('repeat', function (
      this: unknown,
      count: number,
      options: Handlebars.HelperOptions
    ) {
      if (typeof count !== 'number' || !options || typeof options.fn !== 'function') {
        return '';
      }
      let result = '';
      for (let i = 0; i < count; i++) {
        result += options.fn({ ...this, '@index': i, '@first': i === 0, '@last': i === count - 1 });
      }
      return result;
    });

    // Conditional helpers
    this.handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
    this.handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
    this.handlebars.registerHelper('lt', (a: number, b: number) => a < b);
    this.handlebars.registerHelper('lte', (a: number, b: number) => a <= b);
    this.handlebars.registerHelper('gt', (a: number, b: number) => a > b);
    this.handlebars.registerHelper('gte', (a: number, b: number) => a >= b);

    // Math helpers
    this.handlebars.registerHelper('add', (a: number, b: number) => a + b);
    this.handlebars.registerHelper('subtract', (a: number, b: number) => a - b);
    this.handlebars.registerHelper('multiply', (a: number, b: number) => a * b);
    this.handlebars.registerHelper('divide', (a: number, b: number) => a / b);
    this.handlebars.registerHelper('mod', (a: number, b: number) => a % b);

    // String helpers
    this.handlebars.registerHelper('lowercase', (str: string) =>
      typeof str === 'string' ? str.toLowerCase() : ''
    );
    this.handlebars.registerHelper('uppercase', (str: string) =>
      typeof str === 'string' ? str.toUpperCase() : ''
    );
    this.handlebars.registerHelper('capitalize', (str: string) =>
      typeof str === 'string' ? str.charAt(0).toUpperCase() + str.slice(1) : ''
    );

    // Default value helper
    this.handlebars.registerHelper('default', (value: unknown, defaultValue: unknown) =>
      value !== undefined && value !== null && value !== '' ? value : defaultValue
    );
  }
}
