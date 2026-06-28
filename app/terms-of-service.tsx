import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.para}>{children}</Text>;
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.liRow}>
      <Text style={styles.liBullet}>•</Text>
      <Text style={styles.liText}>{children}</Text>
    </View>
  );
}

export default function TermsOfServiceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Términos de Servicio</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.appName}>OnSpace / ClipDAG</Text>
        <Text style={styles.updated}>Última actualización: 28 de junio de 2026</Text>

        {/* ── ESPAÑOL ─────────────────────────────────────────────────────── */}
        <Text style={styles.langHeader}>🇪🇸 Español</Text>

        <Section title="1. Aceptación de los Términos">
          <P>
            Al registrarte o usar OnSpace / ClipDAG ("la Aplicación"), aceptas quedar vinculado por estos
            Términos de Servicio. Si no aceptas estos términos, no puedes usar la Aplicación.
          </P>
          <P>
            Nos reservamos el derecho de modificar estos Términos en cualquier momento. Los cambios entran
            en vigor al publicarlos. El uso continuado de la Aplicación implica la aceptación de los términos
            modificados.
          </P>
        </Section>

        <Section title="2. Elegibilidad — Requisito de edad">
          <P>
            <Text style={styles.bold}>Debes tener al menos 13 años de edad para usar la Aplicación.</Text>
            Si tienes entre 13 y 17 años, debes contar con el consentimiento de tu padre, madre o tutor legal.
            Al aceptar estos Términos, declaras que cumples con este requisito de edad.
          </P>
          <P>
            Si eres padre, madre o tutor y descubres que tu hijo menor de 13 años tiene una cuenta, comunícate
            con nosotros a <Text style={styles.link}>legal@onspace.ai</Text> para eliminarla.
          </P>
        </Section>

        <Section title="3. Tu Cuenta">
          <P>
            Eres responsable de mantener la confidencialidad de tu contraseña y de todas las actividades
            realizadas desde tu cuenta. Debes notificarnos inmediatamente sobre cualquier uso no autorizado.
          </P>
          <Li>No puedes transferir tu cuenta a otra persona.</Li>
          <Li>No puedes crear cuentas múltiples para evadir una suspensión.</Li>
          <Li>Debes proporcionar información veraz y actualizada.</Li>
        </Section>

        <Section title="4. Contenido Prohibido">
          <P>
            Al publicar contenido en la Aplicación, aceptas <Text style={styles.bold}>no publicar</Text>:
          </P>
          <Li>Contenido que muestre o incite violencia, tortura o daño físico a personas o animales.</Li>
          <Li>Contenido sexualmente explícito, pornografía o desnudez no consensual.</Li>
          <Li>Acoso, intimidación, amenazas o discurso de odio contra cualquier persona o grupo.</Li>
          <Li>Contenido que promueva actividades ilegales, incluyendo tráfico de drogas o armas.</Li>
          <Li>Información personal de terceros sin su consentimiento (doxxing).</Li>
          <Li>Spam, contenido engañoso o desinformación deliberada.</Li>
          <Li>Contenido que infrinja derechos de autor, marcas registradas u otros derechos de propiedad intelectual.</Li>
          <Li>Malware, virus u otro software malicioso.</Li>
          <Li>Contenido que explote o dañe a menores de ninguna manera.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            Nos reservamos el derecho de eliminar cualquier contenido que viole estas normas y de suspender
            o cancelar cuentas de manera permanente sin previo aviso.
          </P>
        </Section>

        <Section title="5. Contenido Generado por el Usuario — Propiedad">
          <P>
            Conservas todos los derechos de propiedad intelectual sobre el contenido que publicas. Al subir
            contenido a la Aplicación, nos otorgas una licencia mundial, no exclusiva, libre de regalías para
            usar, reproducir, distribuir y mostrar dicho contenido únicamente con el fin de operar y promover
            la Aplicación.
          </P>
          <P>
            Esta licencia termina cuando eliminas tu contenido o tu cuenta. Eres el único responsable del
            contenido que publicas y de que no infrinja derechos de terceros.
          </P>
        </Section>

        <Section title="6. Créditos BDAG — No son Moneda Real">
          <P>
            <Text style={styles.bold}>
              Los créditos BDAG dentro de la Aplicación son créditos virtuales internos del ecosistema
              OnSpace/ClipDAG. No son moneda de curso legal, no tienen valor monetario garantizado fuera de
              la Aplicación, y no son reembolsables en efectivo.
            </Text>
          </P>
          <Li>Los créditos BDAG se ganan mediante likes en videos y se pueden enviar a otros usuarios.</Li>
          <Li>Las transacciones de créditos BDAG son definitivas e irreversibles.</Li>
          <Li>No ofrecemos garantías sobre el valor futuro de los créditos BDAG.</Li>
          <Li>La función de conectar billeteras blockchain externas es experimental y no implica asesoramiento financiero.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            Esta declaración es requerida para el cumplimiento de las directrices de la App Store de Apple
            y Google Play. Los créditos virtuales de la Aplicación no están regulados por ninguna autoridad
            financiera.
          </P>
        </Section>

        <Section title="7. Política de Terminación de Cuenta">
          <P>Podemos suspender o cancelar tu cuenta de forma temporal o permanente si:</P>
          <Li>Violas estos Términos de Servicio o nuestra Política de Privacidad.</Li>
          <Li>Publicas contenido prohibido según la Sección 4.</Li>
          <Li>Realizas actividades fraudulentas o intentas manipular el sistema de recompensas.</Li>
          <Li>Tu cuenta ha estado inactiva por más de 24 meses.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            También puedes eliminar tu cuenta en cualquier momento contactando a{' '}
            <Text style={styles.link}>legal@onspace.ai</Text>. La eliminación de la cuenta resulta en la
            pérdida permanente de todos los datos, videos y créditos BDAG asociados.
          </P>
        </Section>

        <Section title="8. Limitación de Responsabilidad">
          <P>
            En la máxima medida permitida por la ley aplicable:
          </P>
          <Li>
            La Aplicación se proporciona "tal cual" y "según disponibilidad" sin garantías de ningún tipo,
            expresas o implícitas.
          </Li>
          <Li>
            No somos responsables de pérdidas de datos, interrupciones del servicio, errores técnicos ni
            daños indirectos, incidentales o consecuentes.
          </Li>
          <Li>
            No garantizamos la disponibilidad continua del servicio ni la precisión de ningún contenido
            generado por usuarios.
          </Li>
          <Li>
            No somos responsables de pérdidas relacionadas con créditos BDAG o transacciones en blockchain.
          </Li>
          <P style={{ marginTop: Spacing.sm }}>
            Algunas jurisdicciones no permiten ciertas limitaciones de responsabilidad, por lo que es
            posible que algunas de las exclusiones anteriores no apliquen en tu caso.
          </P>
        </Section>

        <Section title="9. Propiedad Intelectual de la App">
          <P>
            Todo el código fuente, diseño, marca, logotipos, interfaz y funcionalidades de OnSpace / ClipDAG
            son propiedad exclusiva de sus desarrolladores y están protegidos por leyes de propiedad
            intelectual. No puedes copiar, modificar, distribuir ni realizar ingeniería inversa de ninguna
            parte de la Aplicación.
          </P>
        </Section>

        <Section title="10. Ley Aplicable">
          <P>
            Estos Términos se rigen por las leyes aplicables en la jurisdicción de operación de OnSpace.
            Cualquier disputa será resuelta mediante arbitraje vinculante o en los tribunales competentes.
          </P>
        </Section>

        <Section title="11. Contacto">
          <P>
            Para preguntas legales o reportar contenido inapropiado:{'\n'}
            <Text style={styles.link}>legal@onspace.ai</Text>
          </P>
        </Section>

        {/* ── ENGLISH ─────────────────────────────────────────────────────── */}
        <View style={styles.divider} />
        <Text style={styles.langHeader}>🇺🇸 English</Text>

        <Section title="1. Acceptance of Terms">
          <P>
            By registering for or using OnSpace / ClipDAG ("the App"), you agree to be bound by these Terms
            of Service. If you do not accept these terms, you may not use the App.
          </P>
          <P>
            We reserve the right to modify these Terms at any time. Changes take effect upon posting.
            Continued use of the App constitutes acceptance of the modified terms.
          </P>
        </Section>

        <Section title="2. Eligibility — Age Requirement">
          <P>
            <Text style={styles.bold}>You must be at least 13 years of age to use the App.</Text> If you are
            between 13 and 17, you must have the consent of a parent or legal guardian. By accepting these
            Terms, you represent that you meet this age requirement.
          </P>
          <P>
            If you are a parent or guardian and discover that your child under 13 has created an account,
            please contact us at <Text style={styles.link}>legal@onspace.ai</Text> to have it removed.
          </P>
        </Section>

        <Section title="3. Your Account">
          <P>
            You are responsible for maintaining the confidentiality of your password and for all activities
            conducted through your account. You must notify us immediately of any unauthorized use.
          </P>
          <Li>You may not transfer your account to another person.</Li>
          <Li>You may not create multiple accounts to evade a suspension.</Li>
          <Li>You must provide truthful and current information.</Li>
        </Section>

        <Section title="4. Prohibited Content">
          <P>
            By posting content on the App, you agree <Text style={styles.bold}>not to post</Text>:
          </P>
          <Li>Content depicting or inciting violence, torture, or physical harm to people or animals.</Li>
          <Li>Sexually explicit content, pornography, or non-consensual nudity.</Li>
          <Li>Harassment, intimidation, threats, or hate speech against any person or group.</Li>
          <Li>Content promoting illegal activities, including drug or weapons trafficking.</Li>
          <Li>Private information about third parties without their consent (doxxing).</Li>
          <Li>Spam, misleading content, or deliberate misinformation.</Li>
          <Li>Content that infringes copyrights, trademarks, or other intellectual property rights.</Li>
          <Li>Malware, viruses, or other malicious software.</Li>
          <Li>Content that exploits or harms minors in any way.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            We reserve the right to remove any content that violates these rules and to suspend or permanently
            terminate accounts without prior notice.
          </P>
        </Section>

        <Section title="5. User-Generated Content — Ownership">
          <P>
            You retain all intellectual property rights to the content you post. By uploading content to the
            App, you grant us a worldwide, non-exclusive, royalty-free license to use, reproduce, distribute,
            and display such content solely for the purpose of operating and promoting the App.
          </P>
          <P>
            This license ends when you delete your content or your account. You are solely responsible for
            the content you post and for ensuring it does not infringe third-party rights.
          </P>
        </Section>

        <Section title="6. BDAG Credits — Not Real Currency">
          <P>
            <Text style={styles.bold}>
              BDAG credits within the App are internal virtual credits of the OnSpace/ClipDAG ecosystem.
              They are not legal tender, have no guaranteed monetary value outside the App, and are not
              redeemable for cash.
            </Text>
          </P>
          <Li>BDAG credits are earned through video likes and can be sent to other users.</Li>
          <Li>BDAG credit transactions are final and irreversible.</Li>
          <Li>We make no guarantees about the future value of BDAG credits.</Li>
          <Li>The external blockchain wallet connection feature is experimental and does not constitute financial advice.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            This statement is required for compliance with Apple App Store and Google Play guidelines.
            The App's virtual credits are not regulated by any financial authority.
          </P>
        </Section>

        <Section title="7. Account Termination Policy">
          <P>We may suspend or cancel your account temporarily or permanently if you:</P>
          <Li>Violate these Terms of Service or our Privacy Policy.</Li>
          <Li>Post prohibited content as described in Section 4.</Li>
          <Li>Engage in fraudulent activity or attempt to manipulate the rewards system.</Li>
          <Li>Your account has been inactive for more than 24 months.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            You may also delete your account at any time by contacting{' '}
            <Text style={styles.link}>legal@onspace.ai</Text>. Account deletion results in permanent loss
            of all associated data, videos, and BDAG credits.
          </P>
        </Section>

        <Section title="8. Limitation of Liability">
          <P>To the fullest extent permitted by applicable law:</P>
          <Li>
            The App is provided "as is" and "as available" without warranties of any kind, express or implied.
          </Li>
          <Li>
            We are not liable for data loss, service interruptions, technical errors, or indirect, incidental,
            or consequential damages.
          </Li>
          <Li>
            We do not guarantee continuous service availability or the accuracy of any user-generated content.
          </Li>
          <Li>
            We are not liable for losses related to BDAG credits or blockchain transactions.
          </Li>
          <P style={{ marginTop: Spacing.sm }}>
            Some jurisdictions do not allow certain liability limitations, so some of the above exclusions
            may not apply to you.
          </P>
        </Section>

        <Section title="9. App Intellectual Property">
          <P>
            All source code, design, branding, logos, interface, and features of OnSpace / ClipDAG are the
            exclusive property of their developers and are protected by intellectual property laws. You may
            not copy, modify, distribute, or reverse-engineer any part of the App.
          </P>
        </Section>

        <Section title="10. Governing Law">
          <P>
            These Terms are governed by the laws applicable in OnSpace's jurisdiction of operation. Any
            disputes will be resolved through binding arbitration or in courts of competent jurisdiction.
          </P>
        </Section>

        <Section title="11. Contact">
          <P>
            For legal questions or to report inappropriate content:{'\n'}
            <Text style={styles.link}>legal@onspace.ai</Text>
          </P>
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { padding: Spacing.xs },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg },
  appName: {
    color: Colors.primary,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.extrabold,
    textAlign: 'center',
    marginBottom: 4,
  },
  updated: {
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  langHeader: {
    color: Colors.textPrimary,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    marginBottom: Spacing.md,
    marginTop: Spacing.sm,
  },
  section: { marginBottom: Spacing.xl },
  sectionTitle: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    marginBottom: Spacing.sm,
  },
  para: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 22,
    marginBottom: Spacing.sm,
  },
  liRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
    paddingLeft: 4,
  },
  liBullet: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    lineHeight: 22,
    width: 12,
  },
  liText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 22,
  },
  bold: { fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  link: { color: Colors.primary, fontWeight: FontWeight.medium },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xl,
  },
});
