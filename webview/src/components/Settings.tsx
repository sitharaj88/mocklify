import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings as SettingsIcon,
  Server,
  Database,
  ScrollText,
  Info,
  ExternalLink,
  Github,
  Bug,
  Zap,
  Check,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  FormGroup,
  Label,
  FormHint,
} from './ui';
import { cn } from '../lib/utils';
import { useThemeStore } from '../hooks/useTheme';

const settingsTabs = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'server', label: 'Server Defaults', icon: Server },
  { id: 'logging', label: 'Logging', icon: ScrollText },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'about', label: 'About', icon: Info },
];

const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun, description: 'Light theme' },
  { value: 'dark', label: 'Dark', icon: Moon, description: 'Dark theme' },
  { value: 'system', label: 'System', icon: Monitor, description: 'Match system' },
] as const;

export function Settings() {
  const [activeTab, setActiveTab] = useState('general');
  const { theme, setTheme } = useThemeStore();

  return (
    <>
      <header className="content-header">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-surface-700">
            <SettingsIcon className="w-5 h-5 text-surface-300" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-surface-50">Settings</h1>
            <p className="text-sm text-surface-400">Configure Mocklify</p>
          </div>
        </div>
      </header>

      <div className="content-body">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Settings Navigation */}
          <div className="w-full lg:w-56 flex-shrink-0">
            <Card className="overflow-hidden">
              <div className="p-2 flex lg:flex-col gap-1 overflow-x-auto">
                {settingsTabs.map((item) => (
                  <motion.button
                    key={item.id}
                    whileHover={{ x: 4 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap',
                      activeTab === item.id
                        ? 'bg-brand-500/15 text-brand-400'
                        : 'text-surface-400 hover:bg-surface-700/50 hover:text-surface-200'
                    )}
                    onClick={() => setActiveTab(item.id)}
                  >
                    <item.icon size={16} />
                    <span>{item.label}</span>
                  </motion.button>
                ))}
              </div>
            </Card>
          </div>

          {/* Settings Content */}
          <div className="flex-1">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'general' && (
                <Card>
                  <CardHeader>
                    <CardTitle>General Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Theme Selector */}
                    <FormGroup>
                      <Label>Appearance</Label>
                      <div className="grid grid-cols-3 gap-3 mt-2">
                        {themeOptions.map((option) => {
                          const Icon = option.icon;
                          const isSelected = theme === option.value;
                          return (
                            <button
                              key={option.value}
                              onClick={() => setTheme(option.value)}
                              className={cn(
                                'relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                                isSelected
                                  ? 'border-brand-500 bg-brand-500/10'
                                  : 'border-surface-700 hover:border-surface-600 hover:bg-surface-800/50'
                              )}
                            >
                              <div
                                className={cn(
                                  'p-3 rounded-lg',
                                  isSelected
                                    ? 'bg-brand-500/20 text-brand-400'
                                    : 'bg-surface-700 text-surface-400'
                                )}
                              >
                                <Icon size={20} />
                              </div>
                              <span
                                className={cn(
                                  'text-sm font-medium',
                                  isSelected ? 'text-brand-400' : 'text-surface-300'
                                )}
                              >
                                {option.label}
                              </span>
                              {isSelected && (
                                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center">
                                  <Check size={12} className="text-white" />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <FormHint>Choose your preferred color scheme</FormHint>
                    </FormGroup>

                    <div className="border-t border-surface-700 pt-6">
                      <FormGroup>
                        <Label>Configuration Path</Label>
                        <Input
                          defaultValue=".mocklify"
                          placeholder=".mocklify"
                        />
                        <FormHint>Directory where server configurations are stored</FormHint>
                      </FormGroup>
                    </div>

                    <div className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm font-medium text-surface-200">Auto-start servers</p>
                        <p className="text-xs text-surface-500">Start servers when VS Code opens</p>
                      </div>
                      <Switch />
                    </div>

                    <div className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm font-medium text-surface-200">Status bar indicator</p>
                        <p className="text-xs text-surface-500">Show running servers in status bar</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeTab === 'server' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Server Defaults</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormGroup>
                      <Label>Default Port</Label>
                      <Input
                        type="number"
                        defaultValue={3000}
                        min={1}
                        max={65535}
                        className="w-40"
                      />
                    </FormGroup>

                    <FormGroup>
                      <Label>Default Protocol</Label>
                      <Select defaultValue="http">
                        <SelectTrigger className="w-52">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="http">HTTP</SelectItem>
                          <SelectItem value="graphql">GraphQL</SelectItem>
                          <SelectItem value="websocket">WebSocket</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormGroup>

                    <div className="pt-4 border-t border-surface-700">
                      <h4 className="text-sm font-medium text-surface-200 mb-4">CORS Settings</h4>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between py-2">
                          <div>
                            <p className="text-sm font-medium text-surface-200">Enable CORS</p>
                            <p className="text-xs text-surface-500">Allow cross-origin requests</p>
                          </div>
                          <Switch defaultChecked />
                        </div>

                        <FormGroup>
                          <Label>Allowed Origins</Label>
                          <Input
                            defaultValue="*"
                            placeholder="* or comma-separated origins"
                          />
                        </FormGroup>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeTab === 'logging' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Logging Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormGroup>
                      <Label>Maximum Log Entries</Label>
                      <Input
                        type="number"
                        defaultValue={1000}
                        min={100}
                        max={10000}
                        className="w-40"
                      />
                      <FormHint>Older entries will be automatically removed</FormHint>
                    </FormGroup>

                    <div className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm font-medium text-surface-200">Include body in logs</p>
                        <p className="text-xs text-surface-500">Log request and response bodies</p>
                      </div>
                      <Switch defaultChecked />
                    </div>

                    <div className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm font-medium text-surface-200">Output channel logging</p>
                        <p className="text-xs text-surface-500">Also log to VS Code output channel</p>
                      </div>
                      <Switch />
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeTab === 'database' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Database Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormGroup>
                      <Label>JSON Database Directory</Label>
                      <Input
                        defaultValue=".mocklify/data"
                        placeholder=".mocklify/data"
                      />
                    </FormGroup>

                    <div className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm font-medium text-surface-200">Auto-create collections</p>
                        <p className="text-xs text-surface-500">Create JSON collections if they don't exist</p>
                      </div>
                      <Switch defaultChecked />
                    </div>

                    <div className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm font-medium text-surface-200">Persist changes</p>
                        <p className="text-xs text-surface-500">Keep database changes between sessions</p>
                      </div>
                      <Switch />
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeTab === 'about' && (
                <Card>
                  <CardHeader>
                    <CardTitle>About Mocklify</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8">
                      {/* Logo */}
                      <div className="relative w-20 h-20 mx-auto mb-6">
                        <div className="absolute inset-0 bg-brand-500/30 blur-xl rounded-full" />
                        <div className="relative w-full h-full rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/25">
                          <Zap size={40} className="text-white" />
                        </div>
                      </div>

                      <h2 className="text-2xl font-bold text-surface-50 mb-2">Mocklify</h2>
                      <p className="text-surface-400 mb-2">Version 0.1.0</p>
                      <p className="text-surface-400 max-w-md mx-auto mb-6">
                        A powerful API mocking extension for VS Code that enables developers to
                        create, manage, and run mock API servers directly from their IDE.
                      </p>

                      <div className="flex justify-center gap-3">
                        <Button variant="secondary" asChild>
                          <a
                            href="https://github.com/sitharaj88/mocklify"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Github size={16} />
                            GitHub
                          </a>
                        </Button>
                        <Button variant="secondary" asChild>
                          <a
                            href="https://github.com/sitharaj88/mocklify/issues"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Bug size={16} />
                            Report Issue
                          </a>
                        </Button>
                      </div>
                    </div>

                    <div className="border-t border-surface-700 mt-6 pt-6">
                      <h4 className="font-medium text-surface-200 mb-4">Features</h4>
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          'HTTP, GraphQL, and WebSocket servers',
                          'Path parameters and wildcards',
                          'Handlebars template responses',
                          'Faker.js data generation',
                          'Database integration',
                          'Request logging & HAR export',
                          'OpenAPI/Swagger import',
                        ].map((feature) => (
                          <li key={feature} className="flex items-center gap-2 text-sm text-surface-400">
                            <Check size={14} className="text-brand-400 flex-shrink-0" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
}
