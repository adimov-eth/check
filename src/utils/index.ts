export const sendEmail = async (to: string, subject: string, body: string): Promise<void> => {
    // Implement email sending logic (e.g., using Nodemailer)
    console.log(`Email sent to ${to}: ${subject} - ${body}`)
  }